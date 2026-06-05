import { useMemo, useState } from "react";
import { Tag, Icon } from "@blueprintjs/core";
import type { Domain, Incident, OntologyObject } from "../../../shared/types";
import { DOMAIN_COLOR, ALL_DOMAINS, REGIONS } from "../feed/domains";
import { CONTINENT } from "../feed/continents";

interface Props {
  objects: OntologyObject[];
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const PRESETS: { label: string; domains: Domain[] }[] = [
  { label: "All", domains: ALL_DOMAINS },
  { label: "Seismic", domains: ["seismic"] },
  { label: "Disasters", domains: ["disaster", "environmental"] },
  { label: "Maritime + Air", domains: ["maritime", "aviation"] },
];

function fmtClock(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19) + "Z";
}
function fmtAge(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return m + "m";
  if (m < 1440) return Math.round(m / 60) + "h";
  return Math.round(m / 1440) + "d";
}

function DomainChip({ d }: { d: string }) {
  return (
    <span className="mer-domain-chip" style={{ color: DOMAIN_COLOR[d] ?? "#8a93a3" }}>
      <span className="mer-domain-dot" style={{ background: DOMAIN_COLOR[d] ?? "#8a93a3" }} />
      {d}
    </span>
  );
}

export function FeedView({ objects, incidents, selectedId, onSelect }: Props) {
  const [domains, setDomains] = useState<Set<Domain>>(new Set(ALL_DOMAINS));
  const [region, setRegion] = useState("WORLD");
  const [expanded, setExpanded] = useState<string | null>(null);

  const inRegion = (admin0: string | null) =>
    region === "WORLD" || (admin0 != null && CONTINENT[admin0] === region);

  const shownIncidents = useMemo(
    () =>
      incidents.filter((i) => domains.has(i.domain as Domain)).slice(0, 60),
    [incidents, domains],
  );

  // Standalone events (not folded into an incident), newest first.
  const stream = useMemo(
    () =>
      objects
        .filter(
          (o) =>
            !o.incident_id &&
            domains.has(o.domain) &&
            inRegion(o.admin0),
        )
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 120),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, domains, region],
  );

  const members = useMemo(() => {
    if (!expanded) return [];
    return objects
      .filter((o) => o.incident_id === expanded)
      .sort((a, b) => b.severity - a.severity || a.ts - b.ts);
  }, [expanded, objects]);

  const toggleDomain = (d: Domain) =>
    setDomains((prev) => {
      const next = new Set(prev);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  return (
    <div className="mer-feed">
      <div className="mer-feed-scope">
        <div className="mer-feed-presets">
          {PRESETS.map((p) => (
            <button key={p.label} className="mer-preset" onClick={() => setDomains(new Set(p.domains))}>
              {p.label}
            </button>
          ))}
          <span className="mer-feed-region">
            {REGIONS.map((r) => (
              <button
                key={r.code}
                className={`mer-region-btn ${region === r.code ? "on" : ""}`}
                onClick={() => setRegion(r.code)}
              >
                {r.label}
              </button>
            ))}
          </span>
        </div>
        <div className="mer-feed-domains">
          {ALL_DOMAINS.map((d) => (
            <button
              key={d}
              className={`mer-domain-toggle ${domains.has(d) ? "on" : ""}`}
              style={{ borderColor: domains.has(d) ? DOMAIN_COLOR[d] : "transparent" }}
              onClick={() => toggleDomain(d)}
            >
              <span className="mer-domain-dot" style={{ background: DOMAIN_COLOR[d] }} />
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="mer-feed-scroll">
        <div className="mer-section-head">
          <span>Incidents</span>
          <Tag minimal className="mer-mono">{shownIncidents.length}</Tag>
        </div>
        {shownIncidents.length === 0 ? (
          <div className="mer-empty">No correlated incidents in scope.</div>
        ) : (
          shownIncidents.map((i) => (
            <div key={i.id}>
              <button
                className="mer-feed-incident"
                onClick={() => {
                  setExpanded(expanded === i.id ? null : i.id);
                }}
              >
                <Icon icon={expanded === i.id ? "caret-down" : "caret-right"} size={12} color="#6b7689" />
                <span className="mer-feed-count">{i.member_count}</span>
                <DomainChip d={i.domain} />
                <span className="mer-feed-title">{i.label}</span>
                <Tag minimal intent={i.severity_max >= 4 ? "danger" : i.severity_max >= 3 ? "warning" : "none"} className="mer-mono">
                  sev{i.severity_max}
                </Tag>
                <span className="mer-feed-time mer-mono">{fmtAge(i.t_end)}</span>
              </button>
              {expanded === i.id &&
                members.map((m) => (
                  <button key={m.id} className="mer-feed-member" onClick={() => onSelect(m.id)}>
                    <span className="mer-feed-corr">CORRELATED</span>
                    <span className="mer-feed-title">{m.name}</span>
                    <span className="mer-feed-time mer-mono">{m.source}</span>
                  </button>
                ))}
            </div>
          ))
        )}

        <div className="mer-section-head">
          <span>Event Stream</span>
          <Tag minimal className="mer-mono">{stream.length}</Tag>
        </div>
        {stream.map((o) => (
          <button
            key={o.id}
            className={`mer-feed-row ${selectedId === o.id ? "sel" : ""}`}
            onClick={() => onSelect(o.id)}
          >
            <span className="mer-feed-time mer-mono">{fmtClock(o.ts)}</span>
            <DomainChip d={o.domain} />
            <span className="mer-feed-title">{o.name}</span>
            <span className="mer-feed-loc mer-mono">{o.admin0 ?? ""}</span>
            <span className={`mer-sev-pip s${o.severity}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
