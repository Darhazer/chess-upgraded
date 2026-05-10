export default function UpgradeBar({ label, value, max, mine }) {
  const pct = Math.min(100, (value / max) * 100);
  const full = value >= max;
  return (
    <div className={`bar ${mine ? 'mine' : ''} ${full ? 'full' : ''}`}>
      <div className="bar-label">
        <span>{label}</span>
        <span>{value}/{max}</span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
