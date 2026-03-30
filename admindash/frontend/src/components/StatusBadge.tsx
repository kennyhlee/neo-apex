interface StatusBadgeProps {
  status?: string;
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active:     { bg: '#EAF3DE', color: '#3B6D11' },
  enrolled:   { bg: '#EAF3DE', color: '#3B6D11' },
  on_leave:   { bg: '#FAEEDA', color: '#854F0B' },
  suspended:  { bg: '#E6F1FB', color: '#185FA5' },
  graduated:  { bg: '#E6F1FB', color: '#378ADD' },
  dropped:    { bg: '#FBEAF0', color: '#993556' },
  withdrawn:  { bg: '#FBEAF0', color: '#993556' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) return <span>-</span>;

  const key = status.toLowerCase().replace(/\s+/g, '_');
  const style = STATUS_STYLES[key] ?? {
    bg: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
  };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.2rem 0.6rem',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}
