import { useEffect, useRef, useState } from 'react';
import { formatTimeRangeFromStrings } from './calendarTime.ts';
import CalendarChipTooltip from './CalendarChipTooltip.tsx';

type DataRow = Record<string, unknown>;

interface CalendarChipProps {
  program: DataRow;
  onEdit: (program: DataRow) => void;
  /** Optional extra className (used by month-view popover). */
  extraClassName?: string;
}

const TINT_PAIRS = [
  { bg: 'var(--tint-blue-bg)', text: 'var(--tint-blue-text)' },
  { bg: 'var(--tint-green-bg)', text: 'var(--tint-green-text)' },
  { bg: 'var(--tint-amber-bg)', text: 'var(--tint-amber-text)' },
  { bg: 'var(--tint-pink-bg)', text: 'var(--tint-pink-text)' },
];

function getTintForProgram(prog: DataRow): { bg: string; text: string } {
  const key = String(prog.entity_id ?? prog.name ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return TINT_PAIRS[hash % TINT_PAIRS.length];
}

const HOVER_OPEN_DELAY_MS = 250;

export default function CalendarChip({
  program,
  onEdit,
  extraClassName,
}: CalendarChipProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const tint = getTintForProgram(program);
  const label =
    String(program.name ?? program.program_id ?? '').trim() || '(unnamed)';
  const timeLabel = formatTimeRangeFromStrings(
    program.start_time,
    program.end_time,
  );

  function handleMouseEnter() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      if (buttonRef.current) {
        setAnchorRect(buttonRef.current.getBoundingClientRect());
      }
    }, HOVER_OPEN_DELAY_MS);
  }

  function handleMouseLeave() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setAnchorRect(null);
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={`calendar-chip${extraClassName ? ' ' + extraClassName : ''}`}
        style={{ backgroundColor: tint.bg, color: tint.text }}
        onClick={() => onEdit(program)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className="calendar-chip-name">{label}</span>
        {timeLabel && <span className="calendar-chip-time">{timeLabel}</span>}
      </button>
      <CalendarChipTooltip
        anchorRect={anchorRect}
        program={program}
        onClose={() => setAnchorRect(null)}
      />
    </>
  );
}
