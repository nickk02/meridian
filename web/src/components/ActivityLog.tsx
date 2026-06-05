import { useEffect, useState } from "react";
import { Icon, Tag } from "@blueprintjs/core";
import type { Intent } from "@blueprintjs/core";
import type { ActionLogEntry } from "../../../shared/types";
import { api } from "../api";

interface Props {
  version: number;
  onSelect: (id: string) => void;
}

const INTENT: Record<string, Intent> = {
  WATCH: "primary",
  UNWATCH: "none",
  FLAG: "danger",
  UNFLAG: "none",
  ANNOTATE: "success",
};

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(11, 19);
}

export function ActivityLog({ version, onSelect }: Props) {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await api.activity();
        if (alive) setEntries(rows);
      } catch {
        /* leave prior entries on a transient failure */
      }
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [version]);

  return (
    <>
      <div className="mer-section-head">
        <span>Activity Log</span>
        <Icon icon="history" size={12} />
      </div>
      {entries.length === 0 ? (
        <div className="mer-empty">
          Audit trail is empty. Watch, flag, or annotate an object to write the
          first audited action.
        </div>
      ) : (
        <div className="mer-activity">
          {entries.map((e) => (
            <button key={e.id} className="mer-activity-row" onClick={() => onSelect(e.object_id)}>
              <span className="mer-mono mer-activity-ts">{fmtTs(e.ts)}</span>
              <Tag minimal intent={INTENT[e.action] ?? "none"} className="mer-mono">
                {e.action}
              </Tag>
              <span className="mer-mono mer-activity-actor">{e.actor}</span>
              <span className="mer-activity-obj">{e.object_id}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
