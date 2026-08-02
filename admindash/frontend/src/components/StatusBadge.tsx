import { toLabel } from '../utils/listValue.ts';
import { toneFor } from '../utils/tone.ts';
import './StatusBadge.css';

/**
 * The status pill. Tone resolution lives in utils/tone.ts so the badge and the
 * saved-view chips above the table cannot drift apart.
 */
export default function StatusBadge({ status }: { status?: unknown }) {
  const label = toLabel(status, '');
  if (!label || label === '-') return <span>—</span>;

  return <span className={`status-badge status-badge--${toneFor(status)}`}>{label}</span>;
}
