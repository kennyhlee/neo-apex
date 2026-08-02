import './StudentNameCell.css';

/**
 * Six tints from the palette. The choice is a stable hash of the person's
 * name, so the same student always reads the same colour — it aids
 * recognition when scanning, and encodes nothing else.
 */
const TINTS = ['pine', 'slate', 'clay', 'plum', 'teal', 'moss'] as const;

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** "2016-03-11" -> 10. Returns null for missing or unparseable dates. */
function ageFrom(dob: unknown): number | null {
  if (!dob) return null;
  const d = new Date(String(dob));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

export default function StudentNameCell({ row }: { row: Record<string, unknown> }) {
  const first = String(row.first_name ?? '').trim();
  const last = String(row.last_name ?? '').trim();
  const fullName = `${first} ${last}`.trim() || '—';

  // Two initials read as a person; one reads as a filing code.
  const initials =
    ((first.charAt(0) || fullName.charAt(0)) + last.charAt(0)).toUpperCase() || '—';

  const preferred = String(row.preferred_name ?? '').trim();
  const age = ageFrom(row.dob);

  // A secondary line only when there is something worth saying.
  const secondary = [
    preferred && preferred !== first ? `Goes by ${preferred}` : '',
    age != null ? `age ${age}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="student-name-cell">
      <span className={`student-avatar student-avatar--${tintFor(fullName)}`} aria-hidden="true">
        {initials}
      </span>
      <span className="student-name-info">
        <span className="student-display-name">{fullName}</span>
        {secondary ? <span className="student-preferred-name">{secondary}</span> : null}
      </span>
    </div>
  );
}
