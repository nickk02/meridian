// Live global AIS collector. A SQLite-backed Durable Object (free tier) that
// opens the aisstream.io WebSocket in BOUNDED windows driven by the Alarm API:
// connect, listen ~18s for global PositionReports, store the latest position per
// MMSI in DO SQLite, disconnect, schedule the next window. Windowed (not a 24/7
// outbound socket) so the DO stays inside the free tier. The Worker reads the
// snapshot; vessels render as a live overlay, like satellites, not D1 objects.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

const COLLECT_WINDOW_MS = 18_000; // listen window per collection
const COLLECT_INTERVAL_MS = 10 * 60_000; // a window every 10 minutes
const MAX_VESSELS = 3000; // cap stored/served vessels (global AIS is a firehose)
const STALE_MS = 2 * 3600_000; // drop positions older than 2h

interface Pos {
  name: string;
  lat: number;
  lon: number;
  ts: number;
}

export class AisCollector extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS vessels (mmsi TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, ts INTEGER)",
    );
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
  }

  private setMeta(obj: Record<string, unknown>): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta (k, v) VALUES ('diag', ?)",
      JSON.stringify({ at: Date.now(), ...obj }),
    );
  }

  // Snapshot read. Also kickstarts the collection alarm on first contact.
  // ?debug returns the last collection diagnostics instead of vessels.
  async fetch(req: Request): Promise<Response> {
    const params = new URL(req.url).searchParams;
    if (params.has("run")) {
      // Force a collection window now (testing / manual refresh).
      await this.ctx.storage.setAlarm(Date.now() + 200);
    } else if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + 500);
    }
    if (params.has("debug")) {
      const m = this.ctx.storage.sql.exec("SELECT v FROM meta WHERE k = 'diag'").toArray();
      const count = this.ctx.storage.sql.exec("SELECT COUNT(*) AS n FROM vessels").one().n;
      return Response.json({ stored: count, diag: m[0]?.v ? JSON.parse(m[0].v as string) : null });
    }
    const rows = this.ctx.storage.sql
      .exec("SELECT mmsi, name, lat, lon, ts FROM vessels ORDER BY ts DESC LIMIT ?", MAX_VESSELS)
      .toArray();
    return Response.json(rows);
  }

  async alarm(): Promise<void> {
    try {
      await this.collect();
    } catch (e) {
      this.setMeta({ error: `alarm: ${String(e)}` });
    }
    this.ctx.storage.sql.exec("DELETE FROM vessels WHERE ts < ?", Date.now() - STALE_MS);
    await this.ctx.storage.setAlarm(Date.now() + COLLECT_INTERVAL_MS);
  }

  private async collect(): Promise<void> {
    const key = this.env.AISSTREAM_KEY;
    if (!key) {
      this.setMeta({ error: "no AISSTREAM_KEY" });
      return;
    }
    const resp = await fetch("https://stream.aisstream.io/v0/stream", {
      headers: { Upgrade: "websocket" },
    });
    const ws = resp.webSocket;
    if (!ws) {
      this.setMeta({ error: `no webSocket (status ${resp.status})` });
      return;
    }
    ws.accept();

    const positions = new Map<string, Pos>();
    let total = 0;
    let sample = "";
    let closeInfo = "";
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        resolve();
      };
      const timer = setTimeout(finish, COLLECT_WINDOW_MS);
      ws.addEventListener("message", (ev) => {
        try {
          const data = typeof ev.data === "string" ? ev.data : "";
          total++;
          if (total <= 1) sample = data.slice(0, 240);
          const msg = JSON.parse(data) as {
            MessageType?: string;
            MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number };
          };
          if (msg.MessageType !== "PositionReport" || !msg.MetaData) return;
          const md = msg.MetaData;
          const mmsi = String(md.MMSI ?? "");
          const lat = Number(md.latitude);
          const lon = Number(md.longitude);
          if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
          positions.set(mmsi, { name: String(md.ShipName ?? "").trim(), lat, lon, ts: Date.now() });
          if (positions.size >= MAX_VESSELS) finish();
        } catch {
          /* skip malformed frame */
        }
      });
      ws.addEventListener("close", (ev: CloseEvent) => {
        closeInfo = `code=${ev.code} reason=${ev.reason}`;
        finish();
      });
      ws.addEventListener("error", () => {
        closeInfo = "ws error event";
        finish();
      });
      // aisstream requires a subscription message right after connecting.
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ["PositionReport"],
        }),
      );
    });

    this.setMeta({ opened: true, total, kept: positions.size, sample, closeInfo });

    for (const [mmsi, p] of positions) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO vessels (mmsi, name, lat, lon, ts) VALUES (?, ?, ?, ?, ?)",
        mmsi,
        p.name,
        p.lat,
        p.lon,
        p.ts,
      );
    }
  }
}
