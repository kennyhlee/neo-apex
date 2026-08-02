import { toLabel, toToneKey } from '../utils/listValue.ts';
import './StatusBadge.css';

// Map each status value to a tone class (colors live in CSS/tokens).
const TONE: Record<string, string> = {
  active: 'green',
  enrolled: 'green',
  registered: 'green',
  attending: 'green',

  on_leave: 'amber',
  waitlisted: 'amber',
  pending: 'amber',
  applied: 'amber',
  incomplete: 'amber',

  suspended: 'blue',
  graduated: 'blue',
  alumni: 'blue',
  paused: 'blue',

  dropped: 'rose',
  dropped_out: 'rose',
  withdrawn: 'rose',
  inactive: 'rose',
  transferred: 'rose',
  cancelled: 'rose',
  lost: 'rose',
};

/** Tones used for values the map doesn't know, so distinct values still read
 *  as distinct. Deliberately excludes green and rose — guessing "good" or
 *  "bad" for an unknown status would be worse than saying nothing. */
const NEUTRAL_TONES = ['blue', 'gray', 'plum'];

function fallbackTone(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return NEUTRAL_TONES[h % NEUTRAL_TONES.length];
}

export default function StatusBadge({ status }: { status?: unknown }) {
  const label = toLabel(status, '');
  if (!label || label === '-') return <span>—</span>;

  const key = toToneKey(status);
  const tone = TONE[key] ?? fallbackTone(key);

  return <span className={`status-badge status-badge--${tone}`}>{label}</span>;
}
