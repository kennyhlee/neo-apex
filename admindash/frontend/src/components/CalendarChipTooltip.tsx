import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { formatTimeRangeFromStrings } from './calendarTime.ts';

interface CalendarChipTooltipProps {
  anchorRect: DOMRect | null;
  program: Record<string, unknown>;
  onClose: () => void;
}

const TOOLTIP_WIDTH = 260;
const TOOLTIP_HEIGHT = 150;

const DAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const JS_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * Parse a days_of_week field value into a Set of JS day indices (0=Sun..6=Sat).
 * Handles JSON arrays like '["Monday","Tuesday"]', comma-separated, or single values.
 * Returns null if no valid days found.
 */
function parseDaysOfWeek(value: unknown): Set<number> | null {
  if (value == null || value === '') return null;
  let dayNames: string[] = [];
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try {
      dayNames = JSON.parse(s);
    } catch {
      dayNames = [s];
    }
  } else {
    dayNames = s.split(',').map((d) => d.trim());
  }
  const indices = new Set<number>();
  for (const name of dayNames) {
    const idx = JS_DAY_NAMES.findIndex(
      (d) => d.toLowerCase() === name.toLowerCase(),
    );
    if (idx >= 0) indices.add(idx);
  }
  return indices.size > 0 ? indices : null;
}

export default function CalendarChipTooltip({
  anchorRect,
  program,
  onClose,
}: CalendarChipTooltipProps) {
  const { t } = useTranslation();

  const pos = useMemo(() => {
    if (!anchorRect) return null;
    let left = anchorRect.left + window.scrollX;
    let top = anchorRect.bottom + window.scrollY + 6;

    if (left + TOOLTIP_WIDTH > window.innerWidth) {
      left = anchorRect.right + window.scrollX - TOOLTIP_WIDTH;
    }
    if (top + TOOLTIP_HEIGHT > window.innerHeight + window.scrollY) {
      top = anchorRect.top + window.scrollY - 6 - TOOLTIP_HEIGHT;
    }

    return { top, left };
  }, [anchorRect]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!anchorRect || !pos) return null;

  const name =
    String(program.name ?? program.program_id ?? '').trim() || '(unnamed)';

  // --- When row: time range only (no date — calendar cell conveys the day) ---
  const whenValue = formatTimeRangeFromStrings(
    program.start_time,
    program.end_time,
  );

  // --- Where row ---
  const whereValue = String(program.location ?? '').trim();

  // --- Status row ---
  const statusValue = String(program._status ?? '').trim();

  // --- Days row ---
  const daysSet = parseDaysOfWeek(program.days_of_week);
  let daysValue = '';
  if (daysSet && daysSet.size > 0) {
    const indices = Array.from(daysSet).sort((a, b) => a - b);
    daysValue = indices.map((i) => DAY_SHORT_NAMES[i]).join(', ');
  }

  const rows: Array<{ label: string; value: string }> = [];
  if (whenValue) rows.push({ label: t('program.calendarTooltipWhen'), value: whenValue });
  if (whereValue) rows.push({ label: t('program.calendarTooltipWhere'), value: whereValue });
  if (statusValue) rows.push({ label: t('program.calendarTooltipStatus'), value: statusValue });
  if (daysValue) rows.push({ label: t('program.calendarTooltipDays'), value: daysValue });

  return createPortal(
    <div
      className="calendar-chip-tooltip"
      style={{ top: pos.top, left: pos.left, pointerEvents: 'none' }}
    >
      <div className="calendar-chip-tooltip-title">{name}</div>
      {rows.map((row) => (
        <div key={row.label} className="calendar-chip-tooltip-row">
          <span className="calendar-chip-tooltip-label">{row.label}</span>
          <span className="calendar-chip-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
