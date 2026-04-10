import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import CalendarChip from './CalendarChip.tsx';
import './ProgramCalendar.css';

type DataRow = Record<string, unknown>;

const MAX_CHIPS = 3;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ProgramMonthViewProps {
  programs: DataRow[];
  model: ModelDefinition | null;
  onEditProgram: (program: DataRow) => void;
  onSwitchToWeek: (date: Date) => void;
}

/** Returns the first two date/datetime fields from the model definition. */
function getDateFields(model: ModelDefinition | null): ModelFieldDefinition[] {
  if (!model) return [];
  const allFields = [...model.base_fields, ...model.custom_fields];
  return allFields.filter((f) => f.type === 'date' || f.type === 'datetime');
}

/** Parse a date string or Date into a local Date at midnight. */
function parseLocalDate(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value);
  // Handle ISO date strings (YYYY-MM-DD) without timezone shift
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, mo, d] = isoMatch;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Returns true if date is within [start, end] inclusive (date only comparison). */
function isDateInRange(date: Date, start: Date, end: Date | null): boolean {
  const t = date.getTime();
  const s = start.getTime();
  if (end === null) return t === s;
  return t >= s && t <= end.getTime();
}

/**
 * Builds a month grid for the given year/month.
 * Returns an array of weeks, each week is 7 elements (Mon–Sun).
 * null = padding cell before the 1st or after the last.
 */
function getMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  // getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  // We want Mon=0, so shift: (getDay() + 6) % 7
  const startPadding = (firstDay.getDay() + 6) % 7;

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];

  // Leading nulls
  for (let i = 0; i < startPadding; i++) {
    cells.push(null);
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }

  // Trailing nulls to fill complete weeks
  const remainder = cells.length % 7;
  if (remainder !== 0) {
    for (let i = 0; i < 7 - remainder; i++) {
      cells.push(null);
    }
  }

  return cells;
}

/** Format year/month as "April 2026". */
function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Day name lookup: JS getDay() (0=Sun) → day name strings. */
const JS_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse a days_of_week field value into a Set of JS day indices (0=Sun..6=Sat).
 * Handles JSON arrays like '["Monday","Tuesday"]', comma-separated, or single values.
 * Returns null if no valid days found (meaning: show on all days).
 */
function parseDaysOfWeek(value: unknown): Set<number> | null {
  if (value == null || value === '') return null;
  let dayNames: string[] = [];
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try { dayNames = JSON.parse(s); } catch { dayNames = [s]; }
  } else {
    dayNames = s.split(',').map((d) => d.trim());
  }
  const indices = new Set<number>();
  for (const name of dayNames) {
    const idx = JS_DAY_NAMES.findIndex((d) => d.toLowerCase() === name.toLowerCase());
    if (idx >= 0) indices.add(idx);
  }
  return indices.size > 0 ? indices : null;
}

/** Returns true if two dates represent the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function ProgramMonthView({
  programs,
  model,
  onEditProgram,
  onSwitchToWeek,
}: ProgramMonthViewProps) {
  const { t } = useTranslation();
  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  const [morePopover, setMorePopover] = useState<{
    cellIndex: number;
    programs: DataRow[];
    cellDate: Date;
  } | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!morePopover) return;
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMorePopover(null);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [morePopover]);

  const handlePrevMonth = () => {
    if (currentMonth === 0) { setCurrentYear((y) => y - 1); setCurrentMonth(11); }
    else { setCurrentMonth((m) => m - 1); }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) { setCurrentYear((y) => y + 1); setCurrentMonth(0); }
    else { setCurrentMonth((m) => m + 1); }
  };

  const handleToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setMorePopover(null);
  };

  const dateFields = useMemo(() => getDateFields(model), [model]);
  const startField = dateFields[0] ?? null;
  const endField = dateFields[1] ?? null;

  const grid = useMemo(
    () => getMonthGrid(currentYear, currentMonth),
    [currentYear, currentMonth],
  );

  /**
   * For each cell, compute the programs that fall on that day.
   * A program is on a day if [startDate, endDate] spans that day.
   */
  const programsByCell = useMemo<DataRow[][]>(() => {
    if (!startField) return grid.map(() => []);

    return grid.map((cell) => {
      if (cell === null) return [];
      return programs.filter((prog) => {
        const start = parseLocalDate(prog[startField.name]);
        if (!start) return false;

        // Check days_of_week constraint
        const allowedDays = parseDaysOfWeek(prog.days_of_week);
        if (allowedDays && !allowedDays.has(cell.getDay())) return false;

        const end = endField ? parseLocalDate(prog[endField.name]) : null;
        return isDateInRange(cell, start, end);
      });
    });
  }, [grid, programs, startField, endField]);

  // Empty state: no date fields in model
  if (!startField) {
    return (
      <div className="calendar-empty-state">
        <p>{t('program.calendarNoDateFields') || 'No date fields defined in the program model. Add a date field to use the calendar view.'}</p>
      </div>
    );
  }

  return (
    <div className="calendar-month-container">
      {/* Navigation header */}
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={handlePrevMonth} aria-label="Previous month">
          &#8249;
        </button>
        <span className="calendar-nav-label">{formatMonthLabel(currentYear, currentMonth)}</span>
        <button className="calendar-nav-btn" onClick={handleNextMonth} aria-label="Next month">
          &#8250;
        </button>
        <button className="calendar-nav-today" onClick={handleToday}>
          {t('program.calendarToday') || 'Today'}
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="calendar-month-grid">
        {DAY_LABELS.map((label) => (
          <div key={label} className="calendar-month-day-header">
            {label}
          </div>
        ))}

        {/* Day cells */}
        {grid.map((cell, idx) => {
          if (cell === null) {
            return <div key={`pad-${idx}`} className="calendar-month-cell calendar-month-cell-padding" />;
          }

          const isToday = isSameDay(cell, today);
          const cellPrograms = programsByCell[idx] ?? [];
          const visiblePrograms = cellPrograms.slice(0, MAX_CHIPS);
          const hiddenCount = cellPrograms.length - visiblePrograms.length;

          return (
            <div
              key={cell.toISOString()}
              className={[
                'calendar-month-cell',
                isToday ? 'calendar-month-cell-today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Day number */}
              <div className={`calendar-month-cell-number${isToday ? ' calendar-month-cell-number-today' : ''}`}>
                {cell.getDate()}
              </div>

              {/* Program chips */}
              <div className="calendar-month-cell-chips">
                {visiblePrograms.map((prog, chipIdx) => (
                  <CalendarChip
                    key={String(prog.entity_id ?? chipIdx)}
                    program={prog}
                    onEdit={onEditProgram}
                  />
                ))}

                {/* "+N more" button */}
                {hiddenCount > 0 && (
                  <button
                    className="calendar-chip-more"
                    onClick={() =>
                      setMorePopover({
                        cellIndex: idx,
                        programs: cellPrograms,
                        cellDate: cell,
                      })
                    }
                  >
                    {t('program.calendarMore').replace('{count}', String(hiddenCount))}
                  </button>
                )}
              </div>

              {/* Popover for this cell */}
              {morePopover && morePopover.cellIndex === idx && (
                <div className="calendar-month-popover" ref={popoverRef}>
                  <div className="calendar-month-popover-header">
                    <span className="calendar-month-popover-title">
                      {cell.toLocaleString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <button
                      className="calendar-month-popover-close"
                      onClick={() => setMorePopover(null)}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div className="calendar-month-popover-list">
                    {morePopover.programs.map((prog, progIdx) => (
                      <CalendarChip
                        key={String(prog.entity_id ?? progIdx)}
                        program={prog}
                        onEdit={(p) => {
                          setMorePopover(null);
                          onSwitchToWeek(cell);
                          onEditProgram(p);
                        }}
                        extraClassName="calendar-chip-popover"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
