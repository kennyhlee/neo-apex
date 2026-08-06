// Ported from admindash/frontend/src/components/StatusBadge.tsx (interface map §1f).
import { toLabel } from '../utils/listValue.ts';
import { toneFor } from '../utils/tone.ts';
import './StatusBadge.css';

interface StatusBadgeProps {
  status?: unknown;
  /**
   * Display text override — tone is still resolved from `status` (the raw
   * enum value), only the rendered label changes. Callers that need a
   * translated label (a raw enum value like "deprecated" is not itself
   * user-facing copy in a non-English locale) pass this instead of relying
   * on `toLabel(status)`'s pass-through-the-raw-value default.
   */
  label?: string;
}

/**
 * The status pill. Tone resolution lives in utils/tone.ts so the badge and
 * any other tone-consuming UI cannot drift apart.
 */
export default function StatusBadge({ status, label: labelOverride }: StatusBadgeProps) {
  const label = labelOverride ?? toLabel(status, '');
  if (!label || label === '-') return <span>—</span>;

  return <span className={`status-badge status-badge--${toneFor(status)}`}>{label}</span>;
}
