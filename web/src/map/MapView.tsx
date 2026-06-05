import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Feature } from "geojson";
import type { OntologyObject, OntologyLink } from "../../../shared/types";
import { isValidCoord } from "../../../shared/coords";
import { darkBasemap } from "./style";
import { fetchSats, propagateSats, type Sat } from "./satellites";
import { fetchAis } from "./ais";
import { fetchAircraft } from "./aircraft";
import { computeTerminator } from "./terminator";

interface Props {
  objects: OntologyObject[];
  links: OntologyLink[];
  visibleTypes: Set<string>;
  severityMin: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  newIds: Set<string>;
  // Live-overlay visibility, owned by the on-map Layers control.
  satsOn: boolean;
  shipsOn: boolean;
  planesOn: boolean;
}

const ANCHOR = new Set(["PORT", "CHOKEPOINT", "AIRPORT"]);

// Home camera: planet upright (bearing 0, pitch 0), poles vertical. Both the
// fly-in target and the Reset View control return here.
const HOME = { center: [12, 28] as [number, number], zoom: 1.6, bearing: 0, pitch: 0 };

// Bad coordinates are rejected at ingest (shared/coords), so this client filter
// is defense in depth: it keeps a stray endpoint off the map if anything ever
// slips past the door.

// Severity ramp for dynamic events; anchors keep their infrastructure colors.
const COLOR: ExpressionSpecification = [
  "match",
  ["get", "type"],
  "PORT",
  "#5bd6a0",
  "CHOKEPOINT",
  "#e8d44d",
  "AIRPORT",
  "#8fb6ff",
  [
    "match",
    ["get", "severity"],
    1,
    "#36d6e7",
    2,
    "#ffb020",
    3,
    "#ff7a1a",
    4,
    "#ff2d55",
    "#8a93a3",
  ],
];

// Point size scales with BOTH zoom and severity, so dots are pinpricks at world
// view and grow to readable markers as you zoom in (the core "scales" fix).
const DOT_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  1,
  ["interpolate", ["linear"], ["get", "severity"], 1, 1.5, 4, 3],
  6,
  ["interpolate", ["linear"], ["get", "severity"], 1, 3, 4, 7],
  12,
  ["interpolate", ["linear"], ["get", "severity"], 1, 6, 4, 14],
];

const GLOW_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  1,
  ["interpolate", ["linear"], ["get", "severity"], 1, 3, 4, 8],
  6,
  ["interpolate", ["linear"], ["get", "severity"], 1, 6, 4, 16],
  12,
  ["interpolate", ["linear"], ["get", "severity"], 1, 12, 4, 28],
];

function objectsGeo(objs: OntologyObject[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: objs.map((o) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [o.lon, o.lat] },
      properties: {
        id: o.id,
        type: o.type,
        severity: o.severity,
        name: o.name,
        anchor: ANCHOR.has(o.type) ? 1 : 0,
      },
    })),
  };
}

// Types that move between link rebuilds. A CO_LOCATED link (capped at 400km) to
// an aircraft or vessel goes stale as the object flies/sails away, leaving a
// stray line stretched across the map until the hourly rebuild. Suppress those.
const MOVING = new Set(["AIRCRAFT", "VESSEL"]);

function linksGeo(
  links: OntologyLink[],
  byId: Map<string, OntologyObject>,
  visible: (o: OntologyObject) => boolean,
  selectedId: string | null,
): FeatureCollection {
  const features: Feature[] = [];
  for (const l of links) {
    const s = byId.get(l.source_id);
    const t = byId.get(l.target_id);
    if (!s || !t || !visible(s) || !visible(t)) continue;
    if (l.kind === "CO_LOCATED" && (MOVING.has(s.type) || MOVING.has(t.type))) continue;
    const sel = selectedId != null && (l.source_id === selectedId || l.target_id === selectedId);
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [s.lon, s.lat],
          [t.lon, t.lat],
        ],
      },
      properties: { kind: l.kind, sel: sel ? 1 : 0 },
    });
  }
  return { type: "FeatureCollection", features };
}

// Thin atmospheric halo + dark space, applied only on the globe. The horizon
// glow is the project cyan so the planet reads as part of the console, not a
// stock blue marble.
function applyGlobeSky(map: maplibregl.Map) {
  map.setSky({
    "sky-color": "#05070d",
    "horizon-color": "#0d2730",
    "fog-color": "#0a141c",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 4, 0.3, 6, 0],
  });
}

export function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  // Globe is the default framing for the world view; operators can drop to a
  // flat Mercator for analysis work. Persist the choice across tab switches.
  const [globe, setGlobe] = useState(true);
  const globeRef = useRef(globe);
  globeRef.current = globe;
  const satsOn = props.satsOn;
  const shipsOn = props.shipsOn;
  const planesOn = props.planesOn;
  const satsRef = useRef<Sat[]>([]);

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const startGlobe = globeRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkBasemap,
      center: [12, 28],
      // Start pulled back into space for the fly-in; flat view opens framed.
      zoom: startGlobe ? 0.2 : 1.35,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Console handle for operators and end-to-end checks.
    (window as unknown as { __merMap?: maplibregl.Map }).__merMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      if (startGlobe) {
        map.setProjection({ type: "globe" });
        applyGlobeSky(map);
        // Fly-in: ease straight up from deep space to the upright home framing.
        // No bearing/pitch change, so the poles stay vertical on load.
        map.easeTo({
          ...HOME,
          duration: 4200,
          easing: (t) => 1 - Math.pow(1 - t, 3),
        });
      }
      // Day-night terminator: a dark fill over the night hemisphere, beneath all
      // data layers so events and satellites stay readable. Updated on a slow
      // interval (the terminator drifts ~15 deg/hour).
      map.addSource("daynight", { type: "geojson", data: computeTerminator(new Date()) });
      map.addLayer({
        id: "daynight",
        type: "fill",
        source: "daynight",
        paint: { "fill-color": "#01030a", "fill-opacity": 0.4 },
      });

      map.addSource("links", { type: "geojson", data: emptyFc() });
      map.addSource("objects", { type: "geojson", data: emptyFc() });
      map.addSource("selected", { type: "geojson", data: emptyFc() });

      // Links are dim by default and only light up for the selected object, so
      // the web reads as quiet context until you ask a question of it (cartography
      // Stage 1). A selected link also thickens and takes a brighter color.
      map.addLayer({
        id: "links",
        type: "line",
        source: "links",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "sel"], 1],
            ["match", ["get", "kind"], "PROXIMATE_TO", "#5fe6f2", "CO_LOCATED", "#f5b945", "#9aa6b6"],
            ["match", ["get", "kind"], "PROXIMATE_TO", "#1b8a96", "CO_LOCATED", "#9a7320", "#444"],
          ] as ExpressionSpecification,
          "line-width": ["case", ["==", ["get", "sel"], 1], 1.6, 0.5] as ExpressionSpecification,
          "line-opacity": ["case", ["==", ["get", "sel"], 1], 0.9, 0.08] as ExpressionSpecification,
        },
      });

      // Density heatmap at low zoom (dynamic events only), fading out by z6 so
      // busy regions read as heat instead of an unreadable blob of dots.
      map.addLayer({
        id: "objects-heat",
        type: "heatmap",
        source: "objects",
        maxzoom: 6,
        filter: ["!", ["match", ["get", "type"], ["PORT", "CHOKEPOINT", "AIRPORT"], true, false]],
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 1, 0.35, 4, 1] as ExpressionSpecification,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 5, 1.4] as ExpressionSpecification,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "rgba(27,138,150,0.5)",
            0.45, "#1b8a96",
            0.65, "#f2a93b",
            0.85, "#ff6b3d",
            1, "#ff4d4d",
          ] as ExpressionSpecification,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 5, 22] as ExpressionSpecification,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.65, 3.5, 0.5, 6, 0] as ExpressionSpecification,
        },
      });

      map.addLayer({
        id: "objects-glow",
        type: "circle",
        source: "objects",
        paint: {
          "circle-color": COLOR,
          "circle-blur": 1,
          "circle-opacity": 0.3,
          "circle-radius": GLOW_RADIUS,
        },
      });

      map.addLayer({
        id: "objects",
        type: "circle",
        source: "objects",
        paint: {
          "circle-color": COLOR,
          "circle-radius": DOT_RADIUS,
          "circle-stroke-width": ["case", ["==", ["get", "anchor"], 1], 1.5, 0.4],
          "circle-stroke-color": ["case", ["==", ["get", "anchor"], 1], "#0a0e14", "#05080d"],
          "circle-stroke-opacity": 0.9,
        },
      });

      // Labels for significant events only (sev >= 3), so the map reads as
      // named intelligence rather than anonymous dots. Glyphs come from the
      // vector basemap. Gated by zoom and severity to avoid clutter.
      map.addLayer({
        id: "objects-label",
        type: "symbol",
        source: "objects",
        filter: [">=", ["get", "severity"], 3],
        minzoom: 2.5,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 10,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-max-width": 16,
          "text-optional": true,
        },
        paint: {
          "text-color": "#d7e0ec",
          "text-halo-color": "#05080d",
          "text-halo-width": 1.4,
          "text-opacity": ["interpolate", ["linear"], ["zoom"], 2.5, 0, 4, 0.9] as ExpressionSpecification,
        },
      });

      map.addLayer({
        id: "selected",
        type: "circle",
        source: "selected",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 12,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Satellites: live sub-satellite points, propagated client-side and
      // updated on an interval. A faint trailing glow plus a small bright core.
      map.addSource("sats", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "sats-glow",
        type: "circle",
        source: "sats",
        paint: {
          "circle-color": "#a9e6ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3.5, 6, 6] as ExpressionSpecification,
          "circle-blur": 1,
          "circle-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "sats",
        type: "circle",
        source: "sats",
        paint: {
          "circle-color": "#eaf6ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.3, 6, 2.6] as ExpressionSpecification,
          "circle-opacity": 0.95,
        },
      });

      // Live global AIS vessels (overlay; refreshed by polling the collector DO).
      map.addSource("ais", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "ais",
        type: "circle",
        source: "ais",
        paint: {
          "circle-color": "#4ade80",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 6, 3] as ExpressionSpecification,
          "circle-opacity": 0.8,
          "circle-stroke-width": 0.4,
          "circle-stroke-color": "#05140b",
        },
      });

      // Live aircraft overlay (ADS-B; polled, not in D1).
      map.addSource("aircraft", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "aircraft",
        type: "circle",
        source: "aircraft",
        paint: {
          "circle-color": "#8fb6ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.6, 6, 3.4] as ExpressionSpecification,
          "circle-opacity": 0.9,
          "circle-stroke-width": 0.4,
          "circle-stroke-color": "#070d1a",
        },
      });

      // Arrival pulses: an expanding, fading ring on each newly-arrived event,
      // driven by a per-feature progress value t (0..1) updated every frame.
      map.addSource("pulses", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "pulses",
        type: "circle",
        source: "pulses",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#36d6e7",
          "circle-stroke-width": 2,
          "circle-radius": ["interpolate", ["linear"], ["get", "t"], 0, 4, 1, 30] as ExpressionSpecification,
          "circle-stroke-opacity": ["interpolate", ["linear"], ["get", "t"], 0, 0.9, 1, 0] as ExpressionSpecification,
        },
      });

      // One click handler for everything, via queryRenderedFeatures with a pixel
      // buffer (per-layer click events are unreliable on the globe projection, so
      // we hit-test ourselves; the buffer makes tiny dots easy to hit). Ontology
      // objects open the inspector; live overlays (aircraft, ships, satellites)
      // are not ontology objects, so they get a lightweight identity popup.
      const escapeHtml = (s: string) =>
        s.replace(/[&<>"']/g, (ch) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
        );
      let popup: maplibregl.Popup | null = null;
      const overlayPopup = (lngLat: maplibregl.LngLat, kind: string, text: string) => {
        if (!popup) {
          popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, className: "mer-map-popup", maxWidth: "240px" });
        }
        popup
          .setLngLat(lngLat)
          .setHTML(`<span class="mer-popup-kind">${kind}</span><span class="mer-popup-name">${escapeHtml(text)}</span>`)
          .addTo(map);
      };
      const BUF = 5;
      const boxAt = (x: number, y: number): [[number, number], [number, number]] => [
        [x - BUF, y - BUF],
        [x + BUF, y + BUF],
      ];
      map.on("click", (e) => {
        const box = boxAt(e.point.x, e.point.y);
        const obj = map.queryRenderedFeatures(box, { layers: ["objects"] })[0];
        if (obj && typeof obj.properties?.["id"] === "string") {
          onSelectRef.current(obj.properties["id"]);
          return;
        }
        const plane = map.queryRenderedFeatures(box, { layers: ["aircraft"] })[0];
        if (plane) {
          const m = plane.properties?.["model"];
          const alt = plane.properties?.["alt"];
          overlayPopup(e.lngLat, "AIRCRAFT", `${plane.properties?.["name"] ?? "unknown"}${m ? ` · ${m}` : ""}${alt ? ` · ${alt} ft` : ""}`);
          onSelectRef.current(null);
          return;
        }
        const ship = map.queryRenderedFeatures(box, { layers: ["ais"] })[0];
        if (ship) {
          overlayPopup(e.lngLat, "VESSEL", String(ship.properties?.["name"] ?? "unknown"));
          onSelectRef.current(null);
          return;
        }
        const sat = map.queryRenderedFeatures(box, { layers: ["sats"] })[0];
        if (sat) {
          const alt = sat.properties?.["alt"];
          overlayPopup(e.lngLat, "SATELLITE", `${sat.properties?.["name"] ?? "unknown"}${alt != null ? ` · ${alt} km` : ""}`);
          onSelectRef.current(null);
          return;
        }
        onSelectRef.current(null);
      });
      // Pointer cursor over any clickable feature.
      map.on("mousemove", (e) => {
        const over = map.queryRenderedFeatures(boxAt(e.point.x, e.point.y), {
          layers: ["objects", "aircraft", "ais", "sats"],
        }).length > 0;
        map.getCanvas().style.cursor = over ? "pointer" : "";
      });

      readyRef.current = true;
      syncData();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data + filters to the map.
  function syncData() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { objects, links, visibleTypes, severityMin, selectedId } = props;
    // Drop bad-coordinate objects up front so neither dots nor links can render
    // to Null Island; links to a dropped object are skipped (endpoint missing).
    const objs = objects.filter((o) => isValidCoord(o.lat, o.lon));
    const visible = (o: OntologyObject) =>
      visibleTypes.has(o.type) && o.severity >= severityMin;
    const shown = objs.filter(visible);
    const byId = new Map(objs.map((o) => [o.id, o]));

    (map.getSource("objects") as GeoJSONSource | undefined)?.setData(objectsGeo(shown));
    (map.getSource("links") as GeoJSONSource | undefined)?.setData(
      linksGeo(links, byId, visible, selectedId),
    );
    const sel = selectedId ? byId.get(selectedId) : undefined;
    (map.getSource("selected") as GeoJSONSource | undefined)?.setData(
      sel ? objectsGeo([sel]) : emptyFc(),
    );
  }

  useEffect(syncData);

  // Load TLEs once on mount, refresh hourly. Stored in a ref so the animation
  // loop reads the latest without re-subscribing.
  useEffect(() => {
    let alive = true;
    const load = () => fetchSats().then((s) => { if (alive) satsRef.current = s; });
    load();
    const id = window.setInterval(load, 3600_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Animate sub-satellite points (propagate to "now" every 2s) and toggle the
  // layer visibility with satsOn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = satsOn ? "visible" : "none";
    const apply = () => {
      if (!map.getLayer("sats")) return;
      map.setLayoutProperty("sats", "visibility", vis);
      map.setLayoutProperty("sats-glow", "visibility", vis);
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
    if (!satsOn) return;
    const tick = () => {
      if (!readyRef.current || satsRef.current.length === 0) return;
      (map.getSource("sats") as GeoJSONSource | undefined)?.setData(
        propagateSats(satsRef.current, new Date()),
      );
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [satsOn]);

  // Poll the live AIS snapshot and toggle the vessel layer with shipsOn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    let id: number | undefined;
    const start = () => {
      if (!alive) return;
      if (map.getLayer("ais")) {
        map.setLayoutProperty("ais", "visibility", shipsOn ? "visible" : "none");
      }
      if (!shipsOn) return;
      const load = () =>
        fetchAis().then((fc) => {
          // The source exists once start() runs (after map load), so no ready
          // gate is needed here; that gate was dropping the first snapshot.
          if (alive) (map.getSource("ais") as GeoJSONSource | undefined)?.setData(fc);
        });
      load();
      id = window.setInterval(load, 60_000);
    };
    if (readyRef.current) start();
    else map.once("load", start);
    return () => {
      alive = false;
      if (id != null) window.clearInterval(id);
    };
  }, [shipsOn]);

  // Poll the live aircraft snapshot and toggle the layer with planesOn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    let id: number | undefined;
    const start = () => {
      if (!alive) return;
      if (map.getLayer("aircraft")) {
        map.setLayoutProperty("aircraft", "visibility", planesOn ? "visible" : "none");
      }
      if (!planesOn) return;
      const load = () =>
        fetchAircraft().then((fc) => {
          if (alive) (map.getSource("aircraft") as GeoJSONSource | undefined)?.setData(fc);
        });
      load();
      id = window.setInterval(load, 30_000);
    };
    if (readyRef.current) start();
    else map.once("load", start);
    return () => {
      alive = false;
      if (id != null) window.clearInterval(id);
    };
  }, [planesOn]);

  // Drift the day-night terminator (recompute once a minute).
  useEffect(() => {
    const update = () => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      (map.getSource("daynight") as GeoJSONSource | undefined)?.setData(computeTerminator(new Date()));
    };
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Arrival-pulse animation. Each active pulse carries an appearance time; every
  // frame we recompute its progress t and let the layer expand+fade the ring.
  const pulses = useRef<{ lon: number; lat: number; appeared: number }[]>([]);
  const rafRef = useRef<number | null>(null);
  const PULSE_MS = 1600;
  const animatePulses = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      rafRef.current = null;
      return;
    }
    const now = Date.now();
    const active = pulses.current.filter((p) => now - p.appeared < PULSE_MS);
    pulses.current = active;
    (map.getSource("pulses") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: active.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { t: (now - p.appeared) / PULSE_MS },
      })),
    });
    rafRef.current = active.length > 0 ? requestAnimationFrame(animatePulses) : null;
  }, []);

  // Queue pulses for newly-arrived events and kick the loop if idle.
  const newIds = props.newIds;
  useEffect(() => {
    if (newIds.size === 0 || !readyRef.current) return;
    const byId = new Map(props.objects.map((o) => [o.id, o]));
    const now = Date.now();
    let added = 0;
    for (const id of newIds) {
      const o = byId.get(id);
      if (o && isValidCoord(o.lat, o.lon)) {
        pulses.current.push({ lon: o.lon, lat: o.lat, appeared: now });
        if (++added >= 80) break; // cap a burst so a big cron cycle does not flood
      }
    }
    if (pulses.current.length > 0 && rafRef.current == null) animatePulses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIds]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  // Toggle projection after init. Either way the camera returns upright
  // (bearing 0, pitch 0) so the poles stay vertical.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (globe) {
      map.setProjection({ type: "globe" });
      applyGlobeSky(map);
      // Stay where the operator is (don't yank zoom), but restore HOME's upright
      // bearing/pitch so the poles are vertical. HOME is the single source.
      map.easeTo({
        zoom: Math.max(map.getZoom(), HOME.zoom),
        bearing: HOME.bearing,
        pitch: HOME.pitch,
        duration: 1600,
      });
    } else {
      map.setProjection({ type: "mercator" });
      map.easeTo({ bearing: HOME.bearing, pitch: HOME.pitch, duration: 800 });
    }
  }, [globe]);

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ ...HOME, duration: 900 });
  };

  return (
    <div className="mer-map-wrap">
      <div ref={containerRef} className="mer-map" />
      <div className="mer-proj-toggle" role="group" aria-label="Map projection">
        <button
          className={`mer-proj-btn ${globe ? "on" : ""}`}
          onClick={() => setGlobe(true)}
          aria-pressed={globe}
        >
          GLOBE
        </button>
        <button
          className={`mer-proj-btn ${!globe ? "on" : ""}`}
          onClick={() => setGlobe(false)}
          aria-pressed={!globe}
        >
          FLAT
        </button>
        <button className="mer-proj-btn mer-proj-reset" onClick={resetView}>
          RESET VIEW
        </button>
      </div>
    </div>
  );
}

function emptyFc(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
