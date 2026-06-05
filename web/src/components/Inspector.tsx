import { useState } from "react";
import {
  Button,
  ButtonGroup,
  HTMLTable,
  Icon,
  Tag,
  TextArea,
} from "@blueprintjs/core";
import type { ObjectType } from "../../../shared/types";
import { useObjectDetail } from "../hooks";
import { api } from "../api";

interface Props {
  selectedId: string | null;
  typeMap: Map<string, ObjectType>;
  onSelect: (id: string) => void;
  onActed: () => void;
}

const SEVERITY_LABEL = ["", "LOW", "MODERATE", "HIGH", "CRITICAL"];
const SEVERITY_INTENT = ["none", "primary", "warning", "warning", "danger"] as const;

function fmtTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function Inspector({ selectedId, typeMap, onSelect, onActed }: Props) {
  const { detail, refresh } = useObjectDetail(selectedId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: string, payload?: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    try {
      await api.action({ object_id: detail.object.id, action, payload });
      await refresh();
      onActed();
    } finally {
      setBusy(false);
    }
  }

  async function submitNote() {
    const text = note.trim();
    if (!text) return;
    await act("ANNOTATE", { text });
    setNote("");
  }

  return (
    <div>
      <div className="mer-section-head">
        <span>Inspector</span>
        <Icon icon="selection" size={12} />
      </div>

      {!detail ? (
        <div className="mer-empty">
          No object selected. Click an object on the map to inspect it.
        </div>
      ) : (
        <div className="mer-pad">
          <div className="mer-insp-name">{detail.object.name}</div>
          <div className="mer-insp-tags">
            <Tag minimal className="mer-mono" style={{ color: typeMap.get(detail.object.type)?.color }}>
              {typeMap.get(detail.object.type)?.label ?? detail.object.type}
            </Tag>
            <Tag intent={SEVERITY_INTENT[detail.object.severity] ?? "none"} className="mer-mono">
              {SEVERITY_LABEL[detail.object.severity] ?? `SEV ${detail.object.severity}`}
            </Tag>
            {detail.state.watch === 1 && (
              <Tag intent="primary" icon="eye-open" className="mer-mono">
                WATCHED
              </Tag>
            )}
            {detail.state.flag === 1 && (
              <Tag intent="danger" icon="flag" className="mer-mono">
                FLAGGED
              </Tag>
            )}
          </div>

          <ButtonGroup fill className="mer-actions">
            <Button
              small
              icon="eye-open"
              active={detail.state.watch === 1}
              loading={busy}
              onClick={() => act(detail.state.watch === 1 ? "UNWATCH" : "WATCH")}
            >
              {detail.state.watch === 1 ? "Unwatch" : "Watch"}
            </Button>
            <Button
              small
              icon="flag"
              intent={detail.state.flag === 1 ? "danger" : "none"}
              active={detail.state.flag === 1}
              loading={busy}
              onClick={() => act(detail.state.flag === 1 ? "UNFLAG" : "FLAG")}
            >
              {detail.state.flag === 1 ? "Unflag" : "Flag"}
            </Button>
          </ButtonGroup>

          <div className="mer-kv">
            <span>LAT</span>
            <span className="mer-mono">{detail.object.lat.toFixed(4)}</span>
            <span>LON</span>
            <span className="mer-mono">{detail.object.lon.toFixed(4)}</span>
            <span>EVENT</span>
            <span className="mer-mono">{fmtTs(detail.object.ts)}</span>
          </div>

          <div className="mer-sub">PROVENANCE</div>
          <div className="mer-kv">
            <span>SOURCE</span>
            <span className="mer-mono">
              {detail.object.source_url && /^https?:\/\//i.test(detail.object.source_url) ? (
                <a href={detail.object.source_url} target="_blank" rel="noreferrer" className="mer-prov-link">
                  {detail.object.source ?? "source"}
                </a>
              ) : (
                detail.object.source ?? "n/a"
              )}
            </span>
            <span>FETCHED</span>
            <span className="mer-mono">
              {detail.object.fetched_at ? fmtTs(detail.object.fetched_at) : "n/a"}
            </span>
            <span>CONF</span>
            <span className="mer-mono">
              <span className="mer-conf-bar">
                <span style={{ width: `${Math.round(detail.object.confidence * 100)}%` }} />
              </span>
              {detail.object.confidence.toFixed(2)}
            </span>
          </div>

          {detail.entities.length > 0 && (
            <>
              <div className="mer-sub">RESOLVED ENTITIES</div>
              <div className="mer-neighbors">
                {detail.entities.map((e) => (
                  <div key={e.entity.id} className="mer-entity-row" title={`${e.role} via ${e.source}`}>
                    <Tag minimal className="mer-mono">{e.entity.type}</Tag>
                    <span className="mer-neighbor-name">{e.entity.canonical_name}</span>
                    <Tag minimal className="mer-mono mer-neighbor-kind">{e.confidence.toFixed(2)}</Tag>
                  </div>
                ))}
              </div>
            </>
          )}

          {detail.object.props && Object.keys(detail.object.props).length > 0 && (
            <>
              <div className="mer-sub">PROPERTIES</div>
              <HTMLTable compact striped className="mer-props">
                <tbody>
                  {Object.entries(detail.object.props).map(([k, v]) => (
                    <tr key={k}>
                      <td className="mer-mono mer-prop-k">{k}</td>
                      <td className="mer-mono">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            </>
          )}

          <div className="mer-sub">LINKED OBJECTS ({detail.neighbors.length})</div>
          {detail.neighbors.length === 0 ? (
            <div className="mer-faint">No derived links.</div>
          ) : (
            <div className="mer-neighbors">
              {detail.neighbors.slice(0, 40).map((n) => (
                <button
                  key={n.object.id}
                  className="mer-neighbor"
                  onClick={() => onSelect(n.object.id)}
                  title={`basis: ${n.link.basis}`}
                >
                  <span className="mer-swatch" style={{ background: typeMap.get(n.object.type)?.color }} />
                  <span className="mer-neighbor-name">{n.object.name}</span>
                  <Tag minimal className="mer-mono mer-neighbor-kind">
                    {n.link.kind === "PROXIMATE_TO" ? "PROX" : "CO-LOC"} {n.link.confidence.toFixed(2)}
                  </Tag>
                </button>
              ))}
            </div>
          )}

          <div className="mer-sub">ANNOTATIONS</div>
          <div className="mer-note-entry">
            <TextArea
              fill
              small
              growVertically
              value={note}
              placeholder="Add an audited note..."
              onChange={(e) => setNote(e.target.value)}
            />
            <Button small intent="primary" disabled={!note.trim() || busy} onClick={submitNote}>
              Annotate
            </Button>
          </div>
          {detail.annotations.map((a) => (
            <div key={a.id} className="mer-annotation">
              <div className="mer-annotation-meta mer-mono">
                {a.actor} {fmtTs(a.ts)}
              </div>
              <div>{a.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
