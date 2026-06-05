import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Feature } from "geojson";
import type { OntologyObject, OntologyLink } from "../../../shared/types";
import { isValidCoord } from "../../../shared/coords";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { darkBasemap } from "./style";
import { addMapIcons, ICON_IMAGE } from "./icons";
import {
  fetchSats,
  propagateSatsRaw,
  orbitForRec,
  type Sat,
  type SatPoint,
  type OrbitArc,
} from "./satellites";
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
const HOME = { center: [12, 28] as [number, number], zoom: 2.3, bearing: 0, pitch: 0 };

// Zoom clamps. minZoom keeps the globe filling the viewport (no shrinking it to
// a small ball in black margins); the flat view can pull back a little further
// since it tiles the whole world. maxZoom stops at the depth CARTO dark-matter
// still has street tiles, so you can inspect a city incident without hitting
// blur or void. minZoom is applied AFTER the fly-in so the deep-space intro
// (which starts at zoom 0.2) still plays.
const MIN_ZOOM_GLOBE = 2.2;
const MIN_ZOOM_FLAT = 1.0;
const MAX_ZOOM = 18;

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

// Glyphs take over from the dots as you zoom in. The dot fades out by ~z5.5 and
// the type symbol fades in over z3.5..z5.5, so the world view stays a clean dot
// field (no wall of overlapping glyphs) and icons resolve as you move closer.
const DOT_FADE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  3.5,
  0.9,
  5.5,
  0,
];
const ICON_FADE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  3.5,
  0,
  5.5,
  1,
];
// Icon size grows with zoom and a little with severity, so the marker reads as a
// type and severe events sit a touch larger.
const ICON_SIZE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  ["interpolate", ["linear"], ["get", "severity"], 1, 0.48, 4, 0.6],
  9,
  ["interpolate", ["linear"], ["get", "severity"], 1, 0.72, 4, 0.92],
  14,
  ["interpolate", ["linear"], ["get", "severity"], 1, 0.9, 4, 1.15],
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

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );

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
  const satsOnRef = useRef(satsOn);
  satsOnRef.current = satsOn;
  const satsRef = useRef<Sat[]>([]);
  // deck.gl overlay (3D altitude layers) + its data, kept in refs so the
  // animation tick and the React effects can rebuild the layers cheaply.
  const deckRef = useRef<MapboxOverlay | null>(null);
  const satPointsRef = useRef<SatPoint[]>([]);
  // The hovered/selected satellite, if any: only its orbital arc is drawn.
  const hoverSatRef = useRef<SatPoint | null>(null);
  const selectSatRef = useRef<SatPoint | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Shared identity popup for live overlays (used by both the MapLibre click
  // hit-test and deck.gl picking, so satellites lifted into deck still click).
  const showPopup = useCallback((lngLat: [number, number] | maplibregl.LngLat, kind: string, text: string) => {
    const map = mapRef.current;
    if (!map) return;
    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, className: "mer-map-popup", maxWidth: "240px" });
    }
    popupRef.current
      .setLngLat(lngLat)
      .setHTML(`<span class="mer-popup-kind">${kind}</span><span class="mer-popup-name">${escapeHtml(text)}</span>`)
      .addTo(map);
  }, []);

  // Rebuild the deck.gl altitude layers from the current satellite data. Sats are
  // rendered at true orbital altitude on the globe; on the flat (analysis) view
  // the altitude collapses to the surface so it degrades cleanly.
  const buildDeck = useCallback(() => {
    const overlay = deckRef.current;
    if (!overlay) return;
    const layers: Layer[] = [];
    if (satsOnRef.current) {
      const onGlobe = globeRef.current;
      const altScale = onGlobe ? 1 : 0;
      // Orbit arc only for the hovered/selected sat (globe only): a payoff for
      // inspecting one orbit, not a permanent cage over the whole globe.
      if (onGlobe) {
        const focus: SatPoint[] = [];
        for (const s of [selectSatRef.current, hoverSatRef.current]) {
          if (s && !focus.some((f) => f.name === s.name)) focus.push(s);
        }
        if (focus.length) {
          const arcs: OrbitArc[] = focus.flatMap((s) => orbitForRec(s.name, s.rec, new Date()));
          layers.push(
            new PathLayer<OrbitArc>({
              id: "sat-orbit",
              data: arcs,
              getPath: (d) => d.path,
              getColor: [120, 230, 255, 220],
              getWidth: 2,
              widthUnits: "pixels",
              widthMinPixels: 1.5,
              jointRounded: true,
              capRounded: true,
              // Test against the globe's depth so the back half of the orbit is
              // occluded; do not write depth so the arc blends over the surface.
              parameters: { depthCompare: "less-equal", depthWriteEnabled: false },
              pickable: false,
            }),
          );
        }
      }
      // Soft halo behind each sat so the orbital shell reads against space.
      if (onGlobe) {
        layers.push(
          new ScatterplotLayer<SatPoint>({
            id: "sat-glow",
            data: satPointsRef.current,
            getPosition: (d) => [d.lon, d.lat, d.altKm * 1000 * altScale],
            getRadius: 5,
            radiusUnits: "pixels",
            radiusMinPixels: 3,
            getFillColor: [150, 220, 255, 45],
            stroked: false,
            pickable: false,
            parameters: { depthCompare: "less-equal", depthWriteEnabled: false },
          }),
        );
      }
      layers.push(
        new ScatterplotLayer<SatPoint>({
          id: "sat-points",
          data: satPointsRef.current,
          getPosition: (d) => [d.lon, d.lat, d.altKm * 1000 * altScale],
          getRadius: 2.4,
          radiusUnits: "pixels",
          radiusMinPixels: 1.6,
          getFillColor: [234, 246, 255, 240],
          stroked: true,
          getLineColor: [120, 200, 240, 180],
          lineWidthUnits: "pixels",
          lineWidthMinPixels: 0.5,
          pickable: true,
          parameters: { depthCompare: "less-equal" },
          // Hover draws that sat's orbit; rebuild only when the identity changes
          // so a steady hover does not thrash the layer every pointer move.
          onHover: (info) => {
            const d = (info.object as SatPoint | undefined) ?? null;
            if ((d?.name ?? null) !== (hoverSatRef.current?.name ?? null)) {
              hoverSatRef.current = d;
              buildDeckRef.current?.();
            }
            return false;
          },
        }),
      );
    }
    overlay.setProps({ layers });
  }, []);
  // buildDeck calls itself from a deck callback, so route through a ref to avoid
  // a stale closure and a self-referential useCallback dependency.
  const buildDeckRef = useRef(buildDeck);
  buildDeckRef.current = buildDeck;

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
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Console handle for operators and end-to-end checks.
    (window as unknown as { __merMap?: maplibregl.Map }).__merMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", async () => {
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
      // Register the type glyphs as SDF images before any symbol layer
      // references them, so icon-image resolves on first paint.
      await addMapIcons(map);
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
          "circle-opacity": DOT_FADE,
          "circle-stroke-width": ["case", ["==", ["get", "anchor"], 1], 1.5, 0.4],
          "circle-stroke-color": ["case", ["==", ["get", "anchor"], 1], "#0a0e14", "#05080d"],
          "circle-stroke-opacity": DOT_FADE,
        },
      });

      // Type glyphs: a symbol per object keyed off its type, tinted by severity
      // (SDF icon-color) with a thin dark keyline for contrast. Glyphs resolve in
      // as you zoom; below ~z3.5 the dot field carries the world view. Collision
      // declutters at mid zoom and is allowed to overlap once you are close.
      map.addLayer({
        id: "objects-symbols",
        type: "symbol",
        source: "objects",
        minzoom: 3,
        layout: {
          "icon-image": ICON_IMAGE,
          "icon-size": ICON_SIZE,
          "icon-allow-overlap": ["step", ["zoom"], false, 7, true] as unknown as boolean,
          "icon-padding": 2,
          // Billboard: always face the camera and stay upright, so glyphs near
          // the globe limb are not skewed by the surface tangent.
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
        },
        paint: {
          "icon-color": COLOR,
          "icon-halo-color": "#05080d",
          "icon-halo-width": 1.3,
          "icon-opacity": ICON_FADE,
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

      // Satellites are rendered in 3D at true orbital altitude by the deck.gl
      // overlay (created below), not as a flat MapLibre layer.

      // Live global AIS vessels (overlay; refreshed by polling the collector DO).
      // There are thousands, so at low zoom they stay small dots (cheap, and the
      // hit target for clicks); the ship glyph layer switches on once you zoom
      // into a harbor, where only the in-view vessels are laid out.
      map.addSource("ais", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "ais",
        type: "circle",
        source: "ais",
        paint: {
          "circle-color": "#4ade80",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 1.4, 6, 3, 9, 1.5] as ExpressionSpecification,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0.8, 6, 0] as ExpressionSpecification,
          "circle-stroke-width": 0.4,
          "circle-stroke-color": "#05140b",
        },
      });
      map.addLayer({
        id: "ais-symbols",
        type: "symbol",
        source: "ais",
        minzoom: 5,
        layout: {
          "icon-image": "ic-VESSEL",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.42, 9, 0.62] as ExpressionSpecification,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          // Billboard so harbor ship glyphs stay upright facing the camera.
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
        },
        paint: {
          "icon-color": "#6ef0a0",
          "icon-halo-color": "#04150b",
          "icon-halo-width": 1.1,
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, 0.95] as ExpressionSpecification,
        },
      });

      // Live aircraft overlay (ADS-B; polled, not in D1). A plane glyph rotated
      // to its track, so the map shows where each aircraft is heading.
      map.addSource("aircraft", { type: "geojson", data: emptyFc() });
      map.addLayer({
        id: "aircraft",
        type: "symbol",
        source: "aircraft",
        layout: {
          "icon-image": "ic-AIRCRAFT",
          // Small at world view so dense traffic does not become a glyph wall;
          // the plane (rotated to its track) resolves as you zoom in.
          "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.2, 4, 0.4, 7, 0.6] as ExpressionSpecification,
          "icon-rotate": ["coalesce", ["get", "heading"], 0] as unknown as ExpressionSpecification,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": "#a8c6ff",
          "icon-halo-color": "#070d1a",
          "icon-halo-width": 1.1,
          "icon-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.72, 4, 0.95] as ExpressionSpecification,
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
      // objects open the inspector; live overlays (aircraft, ships) get a
      // lightweight identity popup. Satellites are deck.gl objects, so they are
      // picked by deck (see buildDeck), not here.
      const BUF = 5;
      const boxAt = (x: number, y: number): [[number, number], [number, number]] => [
        [x - BUF, y - BUF],
        [x + BUF, y + BUF],
      ];
      map.on("click", (e) => {
        const box = boxAt(e.point.x, e.point.y);
        const obj = map.queryRenderedFeatures(box, { layers: ["objects", "objects-symbols"] })[0];
        if (obj && typeof obj.properties?.["id"] === "string") {
          onSelectRef.current(obj.properties["id"]);
          return;
        }
        const plane = map.queryRenderedFeatures(box, { layers: ["aircraft"] })[0];
        if (plane) {
          const m = plane.properties?.["model"];
          const alt = plane.properties?.["alt"];
          showPopup(e.lngLat, "AIRCRAFT", `${plane.properties?.["name"] ?? "unknown"}${m ? ` · ${m}` : ""}${alt ? ` · ${alt} ft` : ""}`);
          onSelectRef.current(null);
          return;
        }
        const ship = map.queryRenderedFeatures(box, { layers: ["ais"] })[0];
        if (ship) {
          showPopup(e.lngLat, "VESSEL", String(ship.properties?.["name"] ?? "unknown"));
          onSelectRef.current(null);
          return;
        }
        // Satellites are deck.gl objects: pick them via the overlay. Selecting one
        // pins its orbital arc until the next empty click.
        const satInfo = deckRef.current?.pickObject({ x: e.point.x, y: e.point.y, radius: 8, layerIds: ["sat-points"] });
        const sat = satInfo?.object as SatPoint | undefined;
        if (sat) {
          selectSatRef.current = sat;
          showPopup([sat.lon, sat.lat], "SATELLITE", `${sat.name}${Number.isFinite(sat.altKm) ? ` · ${Math.round(sat.altKm)} km` : ""}`);
          onSelectRef.current(null);
          buildDeck();
          return;
        }
        if (selectSatRef.current) {
          selectSatRef.current = null;
          buildDeck();
        }
        onSelectRef.current(null);
      });
      // Pointer cursor over any clickable feature.
      map.on("mousemove", (e) => {
        const over = map.queryRenderedFeatures(boxAt(e.point.x, e.point.y), {
          layers: ["objects", "objects-symbols", "aircraft", "ais", "ais-symbols"],
        }).length > 0;
        map.getCanvas().style.cursor = over ? "pointer" : "";
      });

      // deck.gl overlay for the 3D altitude layers, interleaved so it composites
      // with the globe (back-of-globe sats are occluded by the earth via the
      // shared depth buffer).
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      map.addControl(overlay as unknown as maplibregl.IControl);
      deckRef.current = overlay;

      readyRef.current = true;
      syncData();
      buildDeck();

      // Apply the zoom floor. On globe, wait out the fly-in (which starts from
      // deep space at zoom 0.2) before clamping, so the intro still plays.
      if (startGlobe) {
        window.setTimeout(() => mapRef.current?.setMinZoom(MIN_ZOOM_GLOBE), 4300);
      } else {
        map.setMinZoom(MIN_ZOOM_FLAT);
      }
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

  // Load TLEs once on mount, refresh hourly. An orbit arc is now computed on
  // demand only for the hovered/selected sat, so the load just propagates the
  // live points.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSats().then((s) => {
        if (!alive) return;
        satsRef.current = s;
        satPointsRef.current = propagateSatsRaw(s, new Date());
        buildDeck();
      });
    load();
    const id = window.setInterval(load, 3600_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [buildDeck]);

  // Repropagate the live satellite points every 2s and rebuild the deck.gl
  // layers. Toggling satsOn rebuilds (the ref drives show/hide inside buildDeck).
  useEffect(() => {
    buildDeck();
    if (!satsOn) return;
    const tick = () => {
      if (satsRef.current.length === 0) return;
      satPointsRef.current = propagateSatsRaw(satsRef.current, new Date());
      buildDeck();
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [satsOn, buildDeck]);

  // Poll the live AIS snapshot and toggle the vessel layer with shipsOn.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    let id: number | undefined;
    const start = () => {
      if (!alive) return;
      const shipVis = shipsOn ? "visible" : "none";
      if (map.getLayer("ais")) map.setLayoutProperty("ais", "visibility", shipVis);
      if (map.getLayer("ais-symbols")) map.setLayoutProperty("ais-symbols", "visibility", shipVis);
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
      // Loosen the floor before easing so a flat-zoomed-out camera is not
      // snapped, then clamp to the globe floor.
      map.setProjection({ type: "globe" });
      applyGlobeSky(map);
      map.setMinZoom(MIN_ZOOM_GLOBE);
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
      map.setMinZoom(MIN_ZOOM_FLAT);
      map.easeTo({ bearing: HOME.bearing, pitch: HOME.pitch, duration: 800 });
    }
    // Rebuild deck so satellite altitude lifts on globe and collapses on flat.
    buildDeck();
  }, [globe, buildDeck]);

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
