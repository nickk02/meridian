// Type glyphs for the map. Each ontology type (and the three live overlays) gets
// a simple monochrome silhouette so the map reads as things, a plane, a ship, a
// flame, a quake, instead of a scatter of dots. The glyphs are rasterized from
// SVG and registered as SDF images, which lets the symbol layers tint them at
// runtime (icon-color carries severity) and add a thin dark keyline for contrast
// on both land and water.

import type maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";

// 24x24 viewBox inner markup. Line icons use stroke; a few read better as solid
// silhouettes (plane, ship, satellite, anchor). Color is irrelevant: only the
// alpha coverage is used as the distance field, then tinted per layer.
const STROKE = `fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"`;
const FILL = `fill="#000"`;

const GLYPH: Record<string, string> = {
  // seismograph trace
  SEISMIC: `<path ${STROKE} d="M1 12h3.5l2-6 3 12 2.5-8 1.5 2H23"/>`,
  // mountain with a flat crater and a wisp of eruption
  VOLCANO: `<path ${STROKE} d="M3 21l5-9 1.5 2.5L13 11l5 10z"/><path ${STROKE} d="M11 9c1-1.5.5-3-.5-4"/>`,
  // flame
  WILDFIRE: `<path ${FILL} d="M12 2c2.6 3.2 1 5.2.2 6.4 2-.4 2.4-2.6 2.4-2.6 1.7 1.8 3 4 3 6.7a6 6 0 1 1-12 0c0-2 .8-3.4 1.7-4.6.2 1.4 1 2.2 2 2.6-1.3-2.7.2-6 2.7-8.5z"/>`,
  // cyclone swirl
  STORM: `<circle ${STROKE} cx="12" cy="12" r="2"/><path ${STROKE} d="M14 10c2-3 6-2 6 1 0 2-2 3-4 2M10 14c-2 3-6 2-6-1 0-2 2-3 4-2"/>`,
  // two water waves
  FLOOD: `<path ${STROKE} d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>`,
  // sun (dry / hot)
  DROUGHT: `<circle ${FILL} cx="12" cy="12" r="3.4"/><path ${STROKE} d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>`,
  // snowflake
  ICE: `<path ${STROKE} d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M12 5l-2.4 2M12 5l2.4 2M12 19l-2.4-2M12 19l2.4-2"/>`,
  // warning triangle with a bang
  ALERT: `<path ${STROKE} d="M12 3.5 21.5 20H2.5z"/><path ${STROKE} d="M12 10v4"/><circle ${FILL} cx="12" cy="17" r="1.1"/>`,
  // meteor: head plus streak
  FIREBALL: `<circle ${FILL} cx="15.5" cy="8.5" r="3"/><path ${STROKE} d="M13 11 4 20M9 8l-2 1M12 12l-1 2"/>`,
  // rocket
  LAUNCH: `<path ${STROKE} d="M12 2c3 2.6 4 6 4 9l-1.8 3h-4.4L8 11c0-3 1-6.4 4-9z"/><path ${STROKE} d="M8.2 14l-2.2 2 .6 3M15.8 14l2.2 2-.6 3"/><circle ${FILL} cx="12" cy="9" r="1.3"/>`,
  // control tower
  AIRPORT: `<path ${STROKE} d="M9.5 21h5M12 21v-9M8.5 12h7l-1-4h-5z"/><path ${STROKE} d="M10 6l2-3 2 3"/>`,
  // anchor
  PORT: `<circle ${STROKE} cx="12" cy="4.5" r="2"/><path ${STROKE} d="M12 6.5V21M5 13a7 7 0 0 0 14 0M8.5 11H5M19 11h-3.5M3 14l2-1M21 14l-2-1"/>`,
  // diamond (narrows / chokepoint)
  CHOKEPOINT: `<path ${STROKE} d="M12 3 20 12 12 21 4 12z"/><path ${STROKE} d="M9 12h6"/>`,
  // generic event marker (info)
  NEWS_EVENT: `<circle ${STROKE} cx="12" cy="12" r="9"/><path ${STROKE} d="M12 11v5"/><circle ${FILL} cx="12" cy="8" r="1.2"/>`,
  // top-down plane (north-up so heading rotation works)
  AIRCRAFT: `<path ${FILL} d="M12 2c.9 0 1.4 1.2 1.4 3v4.3l7.6 4.4v2l-7.6-2.2v3.9l2 1.6v1.6L12 23l-3.4-1.4v-1.6l2-1.6v-3.9L3 18.7v-2l7.6-4.4V5c0-1.8.5-3 1.4-3z"/>`,
  // ship (hull, deck, mast)
  VESSEL: `<path ${FILL} d="M3.5 14h17l-2.2 5.2H5.7z"/><path ${STROKE} d="M12 3v8M8.5 7H12M12 11v3"/>`,
  // satellite (body, two panels, antenna)
  SATELLITE: `<rect ${STROKE} x="9.5" y="9.5" width="5" height="5" rx="0.6"/><path ${STROKE} d="M9.5 12H3.5M14.5 12h6M5.5 9.5v5M18.5 9.5v5M12 9.5V5l2-1"/>`,
};

// Map an ontology object's type to its glyph id, with severity-independent
// infra types covered too. The default catches anything new until a glyph ships.
export const ICON_IMAGE: ExpressionSpecification = [
  "match",
  ["get", "type"],
  "SEISMIC", "ic-SEISMIC",
  "VOLCANO", "ic-VOLCANO",
  "WILDFIRE", "ic-WILDFIRE",
  "STORM", "ic-STORM",
  "FLOOD", "ic-FLOOD",
  "DROUGHT", "ic-DROUGHT",
  "ICE", "ic-ICE",
  "ALERT", "ic-ALERT",
  "FIREBALL", "ic-FIREBALL",
  "LAUNCH", "ic-LAUNCH",
  "AIRPORT", "ic-AIRPORT",
  "PORT", "ic-PORT",
  "CHOKEPOINT", "ic-CHOKEPOINT",
  "NEWS_EVENT", "ic-NEWS_EVENT",
  "ic-NEWS_EVENT",
];

function svgDoc(inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64">` +
    inner +
    `</svg>`
  );
}

function rasterize(svg: string, px: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image(px, px);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      resolve(ctx.getImageData(0, 0, px, px));
    };
    img.onerror = () => reject(new Error("svg rasterize failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// The satellite glyph as a 64px PNG data URL, for the deck.gl IconLayer that
// draws sats at orbital altitude. Used as a mask icon (alpha = glyph), tinted at
// runtime, so it reads as a satellite rather than a bare dot.
export function loadSatelliteImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    const px = 64;
    const img = new Image(px, px);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(img, 0, 0, px, px);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("svg rasterize failed"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgDoc(GLYPH.SATELLITE));
  });
}

// Rasterize every glyph and register it as an SDF image. pixelRatio 2 means the
// 64px raster represents a 32px icon at icon-size 1, which the layers scale down.
export async function addMapIcons(map: maplibregl.Map): Promise<void> {
  const PX = 64;
  await Promise.all(
    Object.entries(GLYPH).map(async ([key, inner]) => {
      const id = `ic-${key}`;
      if (map.hasImage(id)) return;
      try {
        const data = await rasterize(svgDoc(inner), PX);
        if (!map.hasImage(id)) map.addImage(id, data, { sdf: true, pixelRatio: 2 });
      } catch {
        /* a single failed glyph just falls back to the default match arm */
      }
    }),
  );
}
