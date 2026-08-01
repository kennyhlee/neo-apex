import './StatusBadge.css';

// Map each status value to a tone class (colors live in CSS/tokens).
const TONE: Record<string, string> = {
  active: 'green', enrolled: 'green',
  on_leave: 'amber', waitlisted: 'amber',
  suspended: 'blue', graduated: 'blue',
  dropped: 'rose', withdrawn: 'rose', inactive: 'rose', transferred: 'rose',
};

export default function StatusBadge({ status }: { status?: string }) {
  if (!status || status === '-') return <span>-</span>;
  const key = String(status).trim().toLowerCase().replace(/\s+/g, '_');
  const tone = TONE[key] ?? 'gray';
  return <span className={`status-badge status-badge--${tone}`}>{status}</span>;
}
