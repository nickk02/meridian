import { useEffect, useMemo, useState } from "react";
import { Navbar, NavbarGroup, Alignment, Tabs, Tab, Tag, Icon } from "@blueprintjs/core";
import type { ObjectType } from "../../shared/types";
import { useOntology, useUtcClock } from "./hooks";
import { MapView } from "./map/MapView";
import { LayerTree } from "./components/LayerTree";
import { Inspector } from "./components/Inspector";
import { GraphView } from "./components/GraphView";
import { ActivityLog } from "./components/ActivityLog";

export function App() {
  const clock = useUtcClock();
  const onto = useOntology();
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [severityMin, setSeverityMin] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("map");
  const [activityVersion, setActivityVersion] = useState(0);

  // Default every type visible the first time the registry loads.
  useEffect(() => {
    if (onto.types.length && visible.size === 0) {
      setVisible(new Set(onto.types.map((t) => t.id)));
    }
  }, [onto.types, visible.size]);

  const typeMap = useMemo(
    () => new Map<string, ObjectType>(onto.types.map((t) => [t.id, t])),
    [onto.types],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of onto.objects) m.set(o.type, (m.get(o.type) ?? 0) + 1);
    return m;
  }, [onto.objects]);

  const shownCount = useMemo(
    () =>
      onto.objects.filter((o) => visible.has(o.type) && o.severity >= severityMin)
        .length,
    [onto.objects, visible, severityMin],
  );

  const toggle = (id: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
          <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
            {onto.objects.length} OBJECTS
          </Tag>
          <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
            {onto.links.length} LINKS
          </Tag>
          <Tag
            minimal
            intent={onto.status === "ok" ? "success" : onto.status === "down" ? "danger" : "none"}
            className="mer-mono"
          >
            <span
              className={`mer-status-dot ${
                onto.status === "ok" ? "ok" : onto.status === "down" ? "down" : "idle"
              }`}
            />
            FEED {onto.status.toUpperCase()}
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
          {onto.loaded ? (
            <LayerTree
              types={onto.types}
              counts={counts}
              visible={visible}
              onToggle={toggle}
              severityMin={severityMin}
              onSeverityMin={setSeverityMin}
              shown={shownCount}
              total={onto.objects.length}
            />
          ) : (
            <>
              <div className="mer-section-head">
                <span>Ontology Layers</span>
                <Icon icon="layers" size={12} />
              </div>
              <div className="mer-empty">
                {onto.status === "down"
                  ? "Feed unavailable. The data API is not bound yet."
                  : "Loading ontology..."}
              </div>
            </>
          )}
        </aside>

        <main className="mer-center">
          <Tabs id="mer-view" className="mer-tabs" selectedTabId={tab} onChange={(t) => setTab(String(t))}>
            <Tab id="map" title="MAP" />
            <Tab id="graph" title="GRAPH" />
          </Tabs>
          <div className="mer-center-body">
            {tab === "map" ? (
              <MapView
                objects={onto.objects}
                links={onto.links}
                visibleTypes={visible}
                severityMin={severityMin}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ) : (
              <GraphView selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} />
            )}
          </div>
        </main>

        <aside className="mer-inspector">
          <Inspector
            selectedId={selectedId}
            typeMap={typeMap}
            onSelect={setSelectedId}
            onActed={() => setActivityVersion((v) => v + 1)}
          />
        </aside>
      </div>

      <footer className="mer-bottom">
        <ActivityLog version={activityVersion} onSelect={setSelectedId} />
      </footer>
    </div>
  );
}
