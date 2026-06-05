import { useEffect, useMemo, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
} from "d3-force";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import type { ObjectType } from "../../../shared/types";
import { useObjectDetail } from "../hooks";

interface Props {
  selectedId: string | null;
  typeMap: Map<string, ObjectType>;
  onSelect: (id: string) => void;
}

interface Node extends SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  center: boolean;
}
interface Edge extends SimulationLinkDatum<Node> {
  kind: string;
}

const W = 680;
const H = 560;

// Ego graph: the selected object at the center, its linked neighbors around it.
// d3-force computes a static layout (ticked synchronously), rendered as SVG.
export function GraphView({ selectedId, typeMap, onSelect }: Props) {
  const { detail } = useObjectDetail(selectedId);
  const [, setTick] = useState(0);

  const { nodes, edges } = useMemo(() => {
    if (!detail) return { nodes: [] as Node[], edges: [] as Edge[] };
    const center: Node = {
      id: detail.object.id,
      name: detail.object.name,
      type: detail.object.type,
      center: true,
    };
    const neighbors: Node[] = detail.neighbors.slice(0, 40).map((n) => ({
      id: n.object.id,
      name: n.object.name,
      type: n.object.type,
      center: false,
    }));
    const ns = [center, ...neighbors];
    const es: Edge[] = detail.neighbors.slice(0, 40).map((n) => ({
      source: detail.object.id,
      target: n.object.id,
      kind: n.link.kind,
    }));
    return { nodes: ns, edges: es };
  }, [detail]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const sim = forceSimulation<Node>(nodes)
      .force("charge", forceManyBody().strength(-260))
      .force(
        "link",
        forceLink<Node, Edge>(edges)
          .id((d) => d.id)
          .distance(110),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(26))
      .stop();
    sim.tick(320);
    setTick((t) => t + 1);
    return () => {
      sim.stop();
    };
  }, [nodes, edges]);

  if (!selectedId || !detail) {
    return (
      <div className="mer-center-placeholder">
        SELECT AN OBJECT TO RENDER ITS EGO GRAPH
      </div>
    );
  }

  return (
    <div className="mer-graph-wrap">
      <svg viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} className="mer-graph-svg">
        {edges.map((e, i) => {
          const s = e.source as Node;
          const t = e.target as Node;
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={e.kind === "PROXIMATE_TO" ? "#1b8a96" : "#9a7320"}
              strokeWidth={0.8}
              strokeOpacity={0.5}
            />
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
            className="mer-graph-node"
            onClick={() => !n.center && onSelect(n.id)}
          >
            <circle
              r={n.center ? 9 : 6}
              fill={typeMap.get(n.type)?.color ?? "#8a93a3"}
              stroke={n.center ? "#ffffff" : "#05080d"}
              strokeWidth={n.center ? 2 : 0.75}
            />
            <text x={n.center ? 13 : 9} y={3} className="mer-graph-label">
              {n.name.length > 30 ? n.name.slice(0, 29) + "..." : n.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
