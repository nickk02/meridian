import { useState } from "react";
import { Tree, Tag, SegmentedControl, Icon } from "@blueprintjs/core";
import type { TreeNodeInfo } from "@blueprintjs/core";
import type { ObjectType, ObjectTypeId } from "../../../shared/types";

interface Props {
  types: ObjectType[];
  counts: Map<string, number>;
  visible: Set<string>;
  onToggle: (id: string) => void;
  severityMin: number;
  onSeverityMin: (n: number) => void;
  shown: number;
  total: number;
  // Live overlays (not ontology objects): aircraft, ships, satellites.
  satsOn: boolean;
  shipsOn: boolean;
  planesOn: boolean;
  onToggleSats: () => void;
  onToggleShips: () => void;
  onTogglePlanes: () => void;
  // When true (the on-map overlay) the panel can collapse to just its header.
  collapsible?: boolean;
}

// Object types grouped into a few collapsible categories. Aircraft and vessels
// are live overlays now (see the Overlays section), so their categories show
// only the static infrastructure that remains in the ontology.
const CATEGORIES: { key: string; label: string; types: ObjectTypeId[] }[] = [
  { key: "geo", label: "Seismic & Volcanic", types: ["SEISMIC", "VOLCANO"] },
  { key: "hazard", label: "Weather & Hazard", types: ["STORM", "FLOOD", "DROUGHT", "ALERT", "WILDFIRE", "ICE"] },
  { key: "transport", label: "Infrastructure", types: ["AIRPORT", "PORT", "CHOKEPOINT"] },
  { key: "space", label: "Space", types: ["FIREBALL", "LAUNCH"] },
  { key: "other", label: "Other", types: ["NEWS_EVENT"] },
];

function categoryOf(id: string): string {
  return CATEGORIES.find((c) => c.types.includes(id as ObjectTypeId))?.key ?? "other";
}

function OverlayRow({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button className="mer-overlay-row" onClick={onClick} aria-pressed={on}>
      <Icon icon={on ? "eye-open" : "eye-off"} size={12} color={on ? "#c6d0de" : "#5a6678"} />
      <span className="mer-swatch" style={{ background: color, opacity: on ? 1 : 0.35 }} />
      <span style={{ opacity: on ? 1 : 0.5 }}>{label}</span>
    </button>
  );
}

export function LayerControl(props: Props) {
  const { types, counts, visible, onToggle } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(true);

  const present = types.filter((t) => (counts.get(t.id) ?? 0) > 0);
  const byCategory = new Map<string, ObjectType[]>();
  for (const t of present) {
    const k = categoryOf(t.id);
    (byCategory.get(k) ?? byCategory.set(k, []).get(k)!).push(t);
  }

  const typeNode = (t: ObjectType): TreeNodeInfo => {
    const on = visible.has(t.id);
    return {
      id: t.id,
      isSelected: on,
      icon: <Icon icon={on ? "eye-open" : "eye-off"} color={on ? "#c6d0de" : "#5a6678"} />,
      label: (
        <span className="mer-layer-row">
          <span className="mer-swatch" style={{ background: t.color, opacity: on ? 1 : 0.35 }} />
          <span style={{ opacity: on ? 1 : 0.5 }}>{t.label}</span>
        </span>
      ),
      secondaryLabel: (
        <Tag minimal round className="mer-mono">
          {counts.get(t.id) ?? 0}
        </Tag>
      ),
    };
  };

  const nodes: TreeNodeInfo[] = CATEGORIES.filter((c) => byCategory.has(c.key)).map((c) => {
    const members = byCategory.get(c.key)!;
    const sum = members.reduce((n, t) => n + (counts.get(t.id) ?? 0), 0);
    return {
      id: `cat:${c.key}`,
      hasCaret: true,
      isExpanded: !collapsed.has(c.key),
      label: <span className="mer-cat-label">{c.label}</span>,
      secondaryLabel: <Tag minimal className="mer-mono">{sum}</Tag>,
      childNodes: members.map(typeNode),
    };
  });

  const toggleCategory = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const onNodeClick = (node: TreeNodeInfo) => {
    const id = String(node.id);
    if (id.startsWith("cat:")) toggleCategory(id.slice(4));
    else onToggle(id);
  };

  return (
    <div className="mer-layerctrl">
      <button
        className="mer-layerctrl-head"
        onClick={() => props.collapsible && setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon="layers" size={13} />
        <span>LAYERS</span>
        <Tag minimal className="mer-mono">{props.shown}/{props.total}</Tag>
        {props.collapsible && <Icon icon={open ? "chevron-up" : "chevron-down"} size={12} color="#6b7689" />}
      </button>

      {open && (
        <div className="mer-layerctrl-body">
          <div className="mer-field-label">SEVERITY FLOOR</div>
          <SegmentedControl
            className="mer-sev-seg"
            fill
            small
            value={String(props.severityMin)}
            onValueChange={(v) => props.onSeverityMin(Number(v))}
            options={[
              { label: "All", value: "1" },
              { label: "2+", value: "2" },
              { label: "3+", value: "3" },
              { label: "Crit", value: "4" },
            ]}
          />

          <div className="mer-cat-label" style={{ margin: "12px 0 4px" }}>LIVE OVERLAYS</div>
          <OverlayRow label="Aircraft" color="#8fb6ff" on={props.planesOn} onClick={props.onTogglePlanes} />
          <OverlayRow label="Ships" color="#4ade80" on={props.shipsOn} onClick={props.onToggleShips} />
          <OverlayRow label="Satellites" color="#eaf6ff" on={props.satsOn} onClick={props.onToggleSats} />

          <Tree
            contents={nodes}
            onNodeClick={onNodeClick}
            onNodeExpand={(node) => toggleCategory(String(node.id).slice(4))}
            onNodeCollapse={(node) => toggleCategory(String(node.id).slice(4))}
            className="mer-tree"
          />
        </div>
      )}
    </div>
  );
}
