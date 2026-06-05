// Single coordinate validator for the whole system. Used at ingest (the door)
// so bad/null coordinates never enter D1, and re-used on the client as defense.
// Null Island (0,0) is effectively always upstream placeholder/error data, not a
// real event at the equator-meridian intersection, so it is rejected too.
export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}
