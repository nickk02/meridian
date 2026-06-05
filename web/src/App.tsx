import { useEffect, useMemo, useState } from "react";
import {
  Navbar,
  NavbarGroup,
  Alignment,
  Tag,
  Icon,
  Button,
  Drawer,
  DrawerSize,
} from "@blueprintjs/core";
import type { ObjectType } from "../../shared/types";
import { useOntology, useUtcClock, useIsMobile, useIncidents, useCrossIncidents } from "./hooks";
import { MapView } from "./map/MapView";
import { LayerControl } from "./components/LayerControl";
import { OverlayChips } from "./components/OverlayChips";
import { Inspector } from "./components/Inspector";
import { GraphView } from "./components/GraphView";
import { FeedSheet } from "./components/FeedSheet";
import { BootOverlay } from "./components/BootOverlay";

export function App() {
  const clock = useUtcClock();
  const onto = useOntology();
  const incidents = useIncidents();
  const crossIncidents = useCrossIncidents();
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [severityMin, setSeverityMin] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"map" | "graph">("map");
  const [activityVersion, setActivityVersion] = useState(0);
  const [layersOpen, setLayersOpen] = useState(false);
  const [booting, setBooting] = useState(true);
  // Live-overlay visibility, owned here so the Layers control and the map share it.
  const [satsOn, setSatsOn] = useState(true);
  const [shipsOn, setShipsOn] = useState(true);
  const [planesOn, setPlanesOn] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setBooting(false), 3100);
    return () => window.clearTimeout(id);
  }, []);

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

  const layerControl = (collapsible: boolean) =>
    onto.loaded ? (
      <LayerControl
        types={onto.types}
        counts={counts}
        visible={visible}
        onToggle={toggle}
        severityMin={severityMin}
        onSeverityMin={setSeverityMin}
        shown={shownCount}
        total={onto.objects.length}
        collapsible={collapsible}
      />
    ) : (
      <div className="mer-layerctrl">
        <div className="mer-layerctrl-head">
          <Icon icon="layers" size={13} />
          <span>LAYERS</span>
        </div>
        <div className="mer-empty">
          {onto.status === "down"
            ? "Feed unavailable. The data API is not bound yet."
            : "Loading ontology..."}
        </div>
      </div>
    );

  const overlayChips = (
    <OverlayChips
      satsOn={satsOn}
      shipsOn={shipsOn}
      planesOn={planesOn}
      onToggleSats={() => setSatsOn((v) => !v)}
      onToggleShips={() => setShipsOn((v) => !v)}
      onTogglePlanes={() => setPlanesOn((v) => !v)}
    />
  );

  const viewToggle = (
    <div className="mer-view-toggle">
      <button className={`mer-view-btn ${tab === "map" ? "on" : ""}`} onClick={() => setTab("map")}>
        MAP
      </button>
      <button className={`mer-view-btn ${tab === "graph" ? "on" : ""}`} onClick={() => setTab("graph")}>
        GRAPH
      </button>
    </div>
  );

  // The fullscreen base: map or graph fills the whole stage, panels float over it.
  const stage = (
    <div className="mer-stage">
      {tab === "map" ? (
        <MapView
          objects={onto.objects}
          links={onto.links}
          visibleTypes={visible}
          severityMin={severityMin}
          selectedId={selectedId}
          onSelect={setSelectedId}
          newIds={onto.newIds}
          satsOn={satsOn}
          shipsOn={shipsOn}
          planesOn={planesOn}
        />
      ) : (
        <GraphView selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} />
      )}

      {/* On-map floating controls (map view only). */}
      {tab === "map" && !isMobile && (
        <>
          {overlayChips}
          <div className="mer-layerctrl-overlay">{layerControl(true)}</div>
        </>
      )}
      {tab === "map" && isMobile && overlayChips}

      {/* Inspector mounts only when something is selected, slides in from the right. */}
      {selectedId &&
        (isMobile ? (
          <Drawer
            isOpen={!!selectedId}
            onClose={() => setSelectedId(null)}
            position="bottom"
            size="70%"
            className="bp5-dark mer-drawer"
            title="Inspector"
          >
            <div className="mer-drawer-body">
              <Inspector selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} onActed={onActed} />
            </div>
          </Drawer>
        ) : (
          <aside className="mer-inspector-float">
            <button
              className="mer-inspector-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close inspector"
            >
              <Icon icon="cross" size={14} />
            </button>
            <Inspector selectedId={selectedId} typeMap={typeMap} onSelect={setSelectedId} onActed={onActed} />
          </aside>
        ))}

      {/* The live event feed rides over the map as a draggable bottom sheet. */}
      <FeedSheet
        objects={onto.objects}
        incidents={incidents}
        crossIncidents={crossIncidents}
        newIds={onto.newIds}
        selectedId={selectedId}
        onSelect={setSelectedId}
        activityVersion={activityVersion}
      />
    </div>
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
            {!isMobile && <span style={{ width: 24 }} />}
            {!isMobile && viewToggle}
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
            {isMobile && <span style={{ width: 8 }} />}
            {isMobile && viewToggle}
          </NavbarGroup>
        </Navbar>

        {stage}

        {isMobile && (
          <Drawer
            isOpen={layersOpen}
            onClose={() => setLayersOpen(false)}
            position="left"
            size={DrawerSize.SMALL}
            className="bp5-dark mer-drawer"
            title="Layers"
          >
            <div className="mer-drawer-body">{layerControl(false)}</div>
          </Drawer>
        )}
      </div>
    </>
  );
}
