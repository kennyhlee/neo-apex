import './StatusBadge.css';

// Map each status value to a tone class (colors live in CSS/tokens).
const TONE: Record<string, string> = {
  active: 'green', enrolled: 'green',
  on_leave: 'amber', waitlisted: 'amber',
  suspended: 'blue', graduated: 'blue',
  dropped: 'rose', withdrawn: 'rose', inactive: 'rose', transferred: 'rose',
};

// Selection fields arrive JSON-encoded (e.g. '["Active"]'); unwrap to a plain label
// so the badge shows `Active`, not `["Active"]`, and the tone lookup matches.
function normalizeStatus(raw: unknown): string {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.join(', ');
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.join(', ');
    } catch { /* not JSON — fall through */ }
  }
  return s;
}

export default function StatusBadge({ status }: { status?: string }) {
  const label = normalizeStatus(status);
  if (!label || label === '-') return <span>-</span>;
  const key = label.toLowerCase().replace(/\s+/g, '_');
  const tone = TONE[key] ?? 'gray';
  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}
