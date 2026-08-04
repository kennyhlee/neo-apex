import { toLabel } from '../utils/listValue.ts';
import { toneFor } from '../utils/tone.ts';
import './StatusBadge.css';

/** Status pill. Tone from the raw status value; text overridable for i18n. */
export default function StatusBadge({ status, label }: { status?: unknown; label?: string }) {
  const text = label ?? toLabel(status, '');
  if (!text || text === '-') return <span>—</span>;

  return <span className={`status-badge status-badge--${toneFor(status)}`}>{text}</span>;
}
