import { useEffect, useState } from "react";
import {
  Navbar,
  NavbarGroup,
  Alignment,
  Tabs,
  Tab,
  Tag,
  Icon,
} from "@blueprintjs/core";
import type { HealthResponse } from "../../shared/types";

type ApiState = "idle" | "ok" | "down";

function useUtcClock(): string {
  const [now, setNow] = useState<string>(() => formatUtc(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatUtc(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

function useApiHealth(): ApiState {
  const [state, setState] = useState<ApiState>("idle");
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch("/api/health");
        const body = (await res.json()) as HealthResponse;
        if (alive) setState(body.ok ? "ok" : "down");
      } catch {
        if (alive) setState("down");
      }
    };
    ping();
    const id = window.setInterval(ping, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return state;
}

export function App() {
  const clock = useUtcClock();
  const api = useApiHealth();

  return (
    <div className="mer-shell">
      <Navbar className="mer-navbar">
        <NavbarGroup align={Alignment.LEFT}>
          <div>
            <div className="mer-brand">MERIDIAN</div>
            <div className="mer-brand-sub">COMMON OPERATING PICTURE</div>
          </div>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          <Tag
            minimal
            intent={api === "ok" ? "success" : api === "down" ? "danger" : "none"}
            className="mer-mono"
          >
            <span className={`mer-status-dot ${api === "ok" ? "ok" : api === "down" ? "down" : "idle"}`} />
            API {api.toUpperCase()}
          </Tag>
          <span style={{ width: 16 }} />
          <span className="mer-clock">
            {clock}
            <span className="mer-clock-z">UTC</span>
          </span>
        </NavbarGroup>
      </Navbar>

      <div className="mer-body">
        <aside className="mer-rail">
          <div className="mer-section-head">
            <span>Ontology Layers</span>
            <Icon icon="layers" size={12} />
          </div>
          <div className="mer-empty">
            No layers yet. Ingestion arrives in Phase 3; the layer tree and live
            counts mount here.
          </div>
        </aside>

        <main className="mer-center">
          <Tabs id="mer-view" className="mer-tabs" selectedTabId="map">
            <Tab id="map" title="MAP" />
            <Tab id="graph" title="GRAPH" />
          </Tabs>
          <div className="mer-center-placeholder">
            MAP SURFACE / PHASE 5
          </div>
        </main>

        <aside className="mer-inspector">
          <div className="mer-section-head">
            <span>Inspector</span>
            <Icon icon="selection" size={12} />
          </div>
          <div className="mer-empty">
            No object selected. Select an object on the map to inspect its type,
            severity, geometry, links, and audited actions.
          </div>
        </aside>
      </div>

      <footer className="mer-bottom">
        <div className="mer-section-head">
          <span>Activity Log</span>
          <Icon icon="history" size={12} />
        </div>
        <div className="mer-empty">
          Audit trail is empty. Operator actions appear here once the ontology is
          live.
        </div>
      </footer>
    </div>
  );
}
