interface StatusBadgeProps {
  status?: string;
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active:     { bg: 'var(--success-muted)', color: 'var(--success)' },
  enrolled:   { bg: 'var(--success-muted)', color: 'var(--success)' },
  on_leave:   { bg: 'var(--warning-muted)', color: 'var(--warning)' },
  suspended:  { bg: 'var(--info-muted)',    color: 'var(--info)' },
  graduated:  { bg: 'var(--accent-muted)',  color: 'var(--accent)' },
  dropped:    { bg: 'var(--danger-muted)',  color: 'var(--danger)' },
  withdrawn:  { bg: 'var(--danger-muted)',  color: 'var(--danger)' },
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
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.8rem',
        fontWeight: 500,
        background: style.bg,
        color: style.color,
      }}
    >
      {status}
    </span>
  );
}
