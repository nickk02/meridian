import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  MapGeoJSONFeature,
  ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { OntologyObject, OntologyLink } from "../../../shared/types";
import { darkBasemap } from "./style";

interface Props {
  objects: OntologyObject[];
  links: OntologyLink[];
  visibleTypes: Set<string>;
  severityMin: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const ANCHOR = new Set(["PORT", "CHOKEPOINT", "AIRPORT"]);

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
    "#2dd6e8",
    2,
    "#f2a93b",
    3,
    "#ff6b3d",
    4,
    "#ff4d4d",
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

function objectsGeo(objs: OntologyObject[]): GeoJSON.FeatureCollection {
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

function linksGeo(
  links: OntologyLink[],
  byId: Map<string, OntologyObject>,
  visible: (o: OntologyObject) => boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const l of links) {
    const s = byId.get(l.source_id);
    const t = byId.get(l.target_id);
    if (!s || !t || !visible(s) || !visible(t)) continue;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [s.lon, s.lat],
          [t.lon, t.lat],
        ],
      },
      properties: { kind: l.kind },
    });
  }
  return { type: "FeatureCollection", features };
}

export function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkBasemap,
      center: [12, 28],
      zoom: 1.35,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Console handle for operators and end-to-end checks.
    (window as unknown as { __merMap?: maplibregl.Map }).__merMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", () => {
      map.addSource("links", { type: "geojson", data: emptyFc() });
      map.addSource("objects", { type: "geojson", data: emptyFc() });
      map.addSource("selected", { type: "geojson", data: emptyFc() });

      map.addLayer({
        id: "links",
        type: "line",
        source: "links",
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "PROXIMATE_TO",
            "#1b8a96",
            "CO_LOCATED",
            "#9a7320",
            "#444",
          ] as ExpressionSpecification,
          "line-width": 0.6,
          "line-opacity": 0.35,
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

      map.on("click", "objects", (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        const id = f?.properties?.["id"];
        if (typeof id === "string") onSelectRef.current(id);
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["objects"] });
        if (hits.length === 0) onSelectRef.current(null);
      });
      map.on("mouseenter", "objects", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "objects", () => (map.getCanvas().style.cursor = ""));

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
    const visible = (o: OntologyObject) =>
      visibleTypes.has(o.type) && o.severity >= severityMin;
    const shown = objects.filter(visible);
    const byId = new Map(objects.map((o) => [o.id, o]));

    (map.getSource("objects") as GeoJSONSource | undefined)?.setData(objectsGeo(shown));
    (map.getSource("links") as GeoJSONSource | undefined)?.setData(
      linksGeo(links, byId, visible),
    );
    const sel = selectedId ? byId.get(selectedId) : undefined;
    (map.getSource("selected") as GeoJSONSource | undefined)?.setData(
      sel ? objectsGeo([sel]) : emptyFc(),
    );
  }

  useEffect(syncData);

  return <div ref={containerRef} className="mer-map" />;
}

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
