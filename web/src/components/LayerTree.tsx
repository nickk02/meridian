import { Tree, Tag, SegmentedControl, Icon } from "@blueprintjs/core";
import type { TreeNodeInfo } from "@blueprintjs/core";
import type { ObjectType } from "../../../shared/types";

interface Props {
  types: ObjectType[];
  counts: Map<string, number>;
  visible: Set<string>;
  onToggle: (id: string) => void;
  severityMin: number;
  onSeverityMin: (n: number) => void;
  shown: number;
  total: number;
}

export function LayerTree(props: Props) {
  const { types, counts, visible, onToggle } = props;

  const nodes: TreeNodeInfo[] = types
    .filter((t) => (counts.get(t.id) ?? 0) > 0)
    .map((t) => {
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
    });

  return (
    <div>
      <div className="mer-section-head">
        <span>Ontology Layers</span>
        <Tag minimal className="mer-mono">
          {props.shown}/{props.total}
        </Tag>
      </div>

      <div className="mer-pad" style={{ paddingBottom: 4 }}>
        <div className="mer-field-label">SEVERITY FLOOR</div>
        <SegmentedControl
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
      </div>

      <Tree
        contents={nodes}
        onNodeClick={(node) => onToggle(String(node.id))}
        className="mer-tree"
      />
    </div>
  );
}
