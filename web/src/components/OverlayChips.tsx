// Small on-map chip row for the live overlays (aircraft, ships, satellites),
// pulled out of the Layers panel so they are always one click away.
interface Props {
  satsOn: boolean;
  shipsOn: boolean;
  planesOn: boolean;
  onToggleSats: () => void;
  onToggleShips: () => void;
  onTogglePlanes: () => void;
}

function Chip({ label, color, on, onClick }: { label: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`mer-overlay-chip ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="mer-overlay-dot" style={{ background: on ? color : "#3a424f" }} />
      {label}
    </button>
  );
}

export function OverlayChips(props: Props) {
  return (
    <div className="mer-overlay-chips">
      <Chip label="Aircraft" color="#8fb6ff" on={props.planesOn} onClick={props.onTogglePlanes} />
      <Chip label="Ships" color="#4ade80" on={props.shipsOn} onClick={props.onToggleShips} />
      <Chip label="Satellites" color="#eaf6ff" on={props.satsOn} onClick={props.onToggleSats} />
    </div>
  );
}
