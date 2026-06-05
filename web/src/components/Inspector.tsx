import { Icon, Tag } from "@blueprintjs/core";
import type { ObjectType, OntologyObject } from "../../../shared/types";

interface Props {
  object: OntologyObject | null;
  typeMap: Map<string, ObjectType>;
}

const SEVERITY_LABEL = ["", "LOW", "MODERATE", "HIGH", "CRITICAL"];
const SEVERITY_INTENT = ["none", "primary", "warning", "warning", "danger"] as const;

// Light inspector for Phase E: identity, type, severity, geometry. The props
// table, linked objects, annotations, and audited actions arrive in Phase F.
export function Inspector({ object, typeMap }: Props) {
  return (
    <div>
      <div className="mer-section-head">
        <span>Inspector</span>
        <Icon icon="selection" size={12} />
      </div>
      {!object ? (
        <div className="mer-empty">
          No object selected. Click an object on the map to inspect it.
        </div>
      ) : (
        <div className="mer-pad">
          <div className="mer-insp-name">{object.name}</div>
          <div className="mer-insp-tags">
            <Tag
              minimal
              className="mer-mono"
              style={{ color: typeMap.get(object.type)?.color }}
            >
              {typeMap.get(object.type)?.label ?? object.type}
            </Tag>
            <Tag intent={SEVERITY_INTENT[object.severity] ?? "none"} className="mer-mono">
              {SEVERITY_LABEL[object.severity] ?? `SEV ${object.severity}`}
            </Tag>
          </div>
          <div className="mer-kv">
            <span>LAT</span>
            <span className="mer-mono">{object.lat.toFixed(4)}</span>
            <span>LON</span>
            <span className="mer-mono">{object.lon.toFixed(4)}</span>
            <span>SOURCE</span>
            <span className="mer-mono">{object.source ?? "n/a"}</span>
            <span>EVENT</span>
            <span className="mer-mono">
              {new Date(object.ts).toISOString().replace("T", " ").slice(0, 19)}Z
            </span>
            <span>ID</span>
            <span className="mer-mono mer-ellip">{object.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
