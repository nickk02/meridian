import { useEffect, useMemo, useState } from "react";
import {
  Navbar,
  NavbarGroup,
  Alignment,
  Tabs,
  Tab,
  Tag,
  Icon,
  Button,
  Drawer,
  DrawerSize,
} from "@blueprintjs/core";
import type { ObjectType } from "../../shared/types";
import { useOntology, useUtcClock, useIsMobile, useIncidents } from "./hooks";
import { MapView } from "./map/MapView";
import { LayerTree } from "./components/LayerTree";
import { Inspector } from "./components/Inspector";
import { GraphView } from "./components/GraphView";
import { FeedView } from "./components/FeedView";
import { ActivityLog } from "./components/ActivityLog";
import { BootOverlay } from "./components/BootOverlay";

export function App() {
  const clock = useUtcClock();
  const onto = useOntology();
  const incidents = useIncidents();
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [severityMin, setSeverityMin] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("map");
  const [activityVersion, setActivityVersion] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setBooting(false), 3100);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (onto.types.length && visible.size === 0) {
      setVisible(new Set(onto.types.map((t) => t.id)));
    }
  }, [onto.types, visible.size]);

  // On mobile, selecting an object slides the inspector up.
  useEffect(() => {
    if (isMobile && selectedId) setInspectorOpen(true);
  }, [isMobile, selectedId]);

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
    () => onto.objects.filter((o) => visible.has(o.type) && o.severity >= severityMin).length,
    [onto.objects, visible, severityMin],
  );

  const toggle = (id: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const onActed = () => setActivityVersion((v) => v + 1);

  const layerTree = onto.loaded ? (
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
  );

  const inspector = (
    <Inspector selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} onActed={onActed} />
  );

  const center = (
    <main className="mer-center">
      <Tabs id="mer-view" className="mer-tabs" selectedTabId={tab} onChange={(t) => setTab(String(t))}>
        <Tab id="feed" title="FEED" />
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
        ) : tab === "feed" ? (
          <FeedView
            objects={onto.objects}
            incidents={incidents}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <GraphView selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} />
        )}
      </div>
    </main>
  );

  return (
    <>
      {booting && <BootOverlay />}
      <div className="mer-shell mer-revealing">
      <Navbar className="mer-navbar">
        <NavbarGroup align={Alignment.LEFT}>
          {isMobile && (
            <Button
              minimal
              icon="layers"
              aria-label="Layers"
              className="mer-nav-btn"
              onClick={() => setLayersOpen(true)}
            />
          )}
          <div>
            <div className="mer-brand">MERIDIAN</div>
            <div className="mer-brand-sub">Connecting the world's events in real time.</div>
          </div>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT}>
          {!isMobile && (
            <>
              <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                {onto.objects.length} OBJECTS
              </Tag>
              <Tag minimal className="mer-mono" style={{ marginRight: 10 }}>
                {onto.links.length} LINKS
              </Tag>
            </>
          )}
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
            {!isMobile && `FEED ${onto.status.toUpperCase()}`}
          </Tag>
          {!isMobile && (
            <>
              <span style={{ width: 16 }} />
              <span className="mer-clock">
                {clock}
                <span className="mer-clock-z">UTC</span>
              </span>
            </>
          )}
          {isMobile && (
            <Button
              minimal
              icon="history"
              aria-label="Activity log"
              className="mer-nav-btn"
              onClick={() => setLogOpen(true)}
            />
          )}
        </NavbarGroup>
      </Navbar>

      {isMobile ? (
        <>
          <div className="mer-body-mobile">{center}</div>

          <Drawer
            isOpen={layersOpen}
            onClose={() => setLayersOpen(false)}
            position="left"
            size={DrawerSize.SMALL}
            className="bp5-dark mer-drawer"
            title="Ontology"
          >
            <div className="mer-drawer-body">{layerTree}</div>
          </Drawer>

          <Drawer
            isOpen={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            position="bottom"
            size="70%"
            className="bp5-dark mer-drawer"
            title="Inspector"
          >
            <div className="mer-drawer-body">{inspector}</div>
          </Drawer>

          <Drawer
            isOpen={logOpen}
            onClose={() => setLogOpen(false)}
            position="bottom"
            size={DrawerSize.SMALL}
            className="bp5-dark mer-drawer"
            title="Activity"
          >
            <div className="mer-drawer-body">
              <ActivityLog version={activityVersion} onSelect={(id) => setSelectedId(id)} />
            </div>
          </Drawer>
        </>
      ) : (
        <>
          <div className="mer-body">
            <aside className="mer-rail">{layerTree}</aside>
            {center}
            <aside className="mer-inspector">{inspector}</aside>
          </div>
          <footer className="mer-bottom">
            <ActivityLog version={activityVersion} onSelect={setSelectedId} />
          </footer>
        </>
      )}
      </div>
    </>
  );
}
