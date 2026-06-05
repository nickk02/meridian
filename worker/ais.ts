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
  }

  // Snapshot read. Also kickstarts the collection alarm on first contact.
  async fetch(_req: Request): Promise<Response> {
    if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + 500);
    }
    const rows = this.ctx.storage.sql
      .exec("SELECT mmsi, name, lat, lon, ts FROM vessels ORDER BY ts DESC LIMIT ?", MAX_VESSELS)
      .toArray();
    return Response.json(rows);
  }

  async alarm(): Promise<void> {
    try {
      await this.collect();
    } catch {
      /* a failed window just means an empty refresh; try again next interval */
    }
    this.ctx.storage.sql.exec("DELETE FROM vessels WHERE ts < ?", Date.now() - STALE_MS);
    await this.ctx.storage.setAlarm(Date.now() + COLLECT_INTERVAL_MS);
  }

  private async collect(): Promise<void> {
    const key = this.env.AISSTREAM_KEY;
    if (!key) return;
    const resp = await fetch("https://stream.aisstream.io/v0/stream", {
      headers: { Upgrade: "websocket" },
    });
    const ws = resp.webSocket;
    if (!ws) return;
    ws.accept();

    const positions = new Map<string, Pos>();
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
      ws.addEventListener("close", finish);
      ws.addEventListener("error", finish);
      // aisstream requires a subscription message right after connecting.
      ws.send(
        JSON.stringify({
          APIKey: key,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ["PositionReport"],
        }),
      );
    });

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
