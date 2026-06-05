import type { StyleSpecification } from "maplibre-gl";

// Keyless dark basemap: CARTO dark raster tiles (OSM data, CARTO styling).
// No token required; attribution is mandatory and set below.
export const darkBasemap: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0e14" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.85 } },
  ],
};
