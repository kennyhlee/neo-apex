import './StudentNameCell.css';

export default function StudentNameCell({ row }: { row: Record<string, unknown> }) {
  const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '-';
  const lastName = String(row.last_name ?? '');
  const avatarChar = (lastName.charAt(0) || fullName.charAt(0)).toUpperCase();
  return (
    <div className="student-name-cell">
      <div className="student-avatar">{avatarChar}</div>
      <div className="student-name-info">
        <span className="student-display-name">{fullName}</span>
        {row.preferred_name ? (
          <span className="student-preferred-name">{String(row.preferred_name)}</span>
        ) : null}
      </div>
    </div>
  );
}
