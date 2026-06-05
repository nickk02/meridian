// Boot sequence overlay. Plays once on load, then fades and unmounts. Honors
// prefers-reduced-motion via CSS (the overlay is hidden under that query).
const LINES: [string, string][] = [
  ["ESTABLISHING SECURE LINK", "OK"],
  ["MOUNTING FEED ADAPTERS", "11/11"],
  ["RESOLVING ENTITY GRAPH", "OK"],
  ["CALIBRATING CORRELATION", "OK"],
];

export function BootOverlay() {
  return (
    <div className="mer-boot">
      <div style={{ textAlign: "center" }}>
        <div className="mer-boot-mark">MERIDIAN</div>
        <div className="mer-boot-sub">COMMON OPERATING PICTURE</div>
      </div>
      <div className="mer-boot-lines">
        {LINES.map((l, i) => (
          <div
            key={i}
            className="mer-boot-line"
            style={{ animationDelay: `${0.5 + i * 0.4}s` }}
          >
            {l[0]}
            <span className="ok">{l[1]}</span>
          </div>
        ))}
        <div className="mer-boot-line ready" style={{ animationDelay: "2.15s" }}>
          SYSTEM READY
        </div>
      </div>
    </div>
  );
}
