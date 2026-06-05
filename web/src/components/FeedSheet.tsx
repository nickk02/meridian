import { useMemo, useRef, useState } from "react";
import { Icon, Tag } from "@blueprintjs/core";
import type { Incident, OntologyObject, CrossIncident } from "../../../shared/types";
import { DOMAIN_COLOR } from "../feed/domains";
import { FeedView } from "./FeedView";
import { ActivityLog } from "./ActivityLog";

interface Props {
  objects: OntologyObject[];
  incidents: Incident[];
  crossIncidents: CrossIncident[];
  newIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  activityVersion: number;
}

const COLLAPSED = 46; // ticker-only height
const SNAP = COLLAPSED + 28; // below this we treat the sheet as collapsed
const DEFAULT_OPEN = () => Math.round(window.innerHeight * 0.6);

function fmtClock(ts: number): string {
  return new Date(ts).toISOString().slice(11, 16) + "Z";
}

// The bottom event feed. Three states: a thin live ticker (collapsed default),
// the full scrollable feed (expanded), and any height in between via the drag
// grip. Replaces both the old activity-log strip and the FEED top-level tab.
export function FeedSheet(props: Props) {
  const { objects, newIds, onSelect } = props;
  const [height, setHeight] = useState(COLLAPSED);
  const [showHistory, setShowHistory] = useState(false);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const expanded = height > SNAP;

  // Newest events, newest first, for the ticker.
  const ticker = useMemo(
    () => [...objects].sort((a, b) => b.ts - a.ts).slice(0, 18),
    [objects],
  );
  const freshCount = useMemo(
    () => ticker.reduce((n, o) => n + (newIds.has(o.id) ? 1 : 0), 0),
    [ticker, newIds],
  );

  const clamp = (h: number) =>
    Math.min(window.innerHeight - 92, Math.max(COLLAPSED, h));

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    if (Math.abs(dy) > 3) drag.current.moved = true;
    setHeight(clamp(drag.current.h + dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d && !d.moved) toggle(); // a tap on the grip toggles
  };

  const toggle = () => setHeight((h) => (h > SNAP ? COLLAPSED : DEFAULT_OPEN()));

  return (
    <div className="mer-sheet" style={{ height }}>
      <div
        className="mer-sheet-grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
        aria-label="Resize feed"
      >
        <span className="mer-grip-bar" />
      </div>

      {expanded ? (
        <div className="mer-sheet-open">
          <div className="mer-sheet-head">
            <span className="mer-live-dot" />
            <span className="mer-sheet-title">{showHistory ? "ACTIVITY" : "EVENT FEED"}</span>
            <Tag minimal className="mer-mono">{objects.length}</Tag>
            <span className="mer-sheet-spacer" />
            <button
              className={`mer-sheet-tab ${showHistory ? "on" : ""}`}
              onClick={() => setShowHistory((v) => !v)}
            >
              <Icon icon="history" size={11} />
              History
            </button>
            <button className="mer-sheet-collapse" onClick={() => setHeight(COLLAPSED)} aria-label="Collapse">
              <Icon icon="chevron-down" size={14} color="#6b7689" />
            </button>
          </div>
          <div className="mer-sheet-body">
            {showHistory ? (
              <div className="mer-sheet-history">
                <ActivityLog version={props.activityVersion} onSelect={onSelect} />
              </div>
            ) : (
              <FeedView
                objects={objects}
                incidents={props.incidents}
                crossIncidents={props.crossIncidents}
                selectedId={props.selectedId}
                onSelect={onSelect}
              />
            )}
          </div>
        </div>
      ) : (
        <button className="mer-ticker" onClick={() => setHeight(DEFAULT_OPEN())} aria-label="Expand feed">
          <span className="mer-live-dot" />
          <span className="mer-ticker-label mer-mono">
            LIVE{freshCount > 0 && <span className="mer-ticker-new">+{freshCount}</span>}
          </span>
          <div className="mer-ticker-track">
            {ticker.map((o) => (
              <span
                key={o.id}
                className={`mer-ticker-item ${newIds.has(o.id) ? "fresh" : ""}`}
              >
                <span className="mer-ticker-time mer-mono">{fmtClock(o.ts)}</span>
                <span className="mer-ticker-dot" style={{ background: DOMAIN_COLOR[o.domain] ?? "#8a93a3" }} />
                <span className="mer-ticker-name">{o.name}</span>
              </span>
            ))}
          </div>
          <Icon icon="chevron-up" size={14} color="#6b7689" />
        </button>
      )}
    </div>
  );
}
