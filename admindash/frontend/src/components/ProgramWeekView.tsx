import { useState, useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './ProgramCalendar.css';

type DataRow = Record<string, unknown>;

const TINT_PAIRS = [
  { bg: 'var(--tint-blue-bg)', text: 'var(--tint-blue-text)' },
  { bg: 'var(--tint-green-bg)', text: 'var(--tint-green-text)' },
  { bg: 'var(--tint-amber-bg)', text: 'var(--tint-amber-text)' },
  { bg: 'var(--tint-pink-bg)', text: 'var(--tint-pink-text)' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ProgramWeekViewProps {
  programs: DataRow[];
  model: ModelDefinition | null;
  onEditProgram: (program: DataRow) => void;
  weekStart?: Date;
}

/** Returns all date/datetime fields from the model definition. */
function getDateFields(model: ModelDefinition): ModelFieldDefinition[] {
  const all = [...model.base_fields, ...model.custom_fields];
  return all.filter((f) => f.type === 'date' || f.type === 'datetime');
}

/** Returns the Monday of the week containing the given date. */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Parses a string value to a Date, or returns null. */
function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Returns true if two dates fall on the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Returns true if date falls within [start, end] (inclusive, day-level). */
function isInRange(date: Date, start: Date, end: Date): boolean {
  const d = date.getTime();
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(23, 59, 59, 999);
  return d >= s.getTime() && d <= e.getTime();
}

export default function ProgramWeekView({
  programs,
  model,
  onEditProgram,
  weekStart,
}: ProgramWeekViewProps) {
  const { t } = useTranslation();

  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() =>
    getWeekStart(weekStart ?? new Date()),
  );

  // The 7 days of the current week (Mon–Sun)
  const weekDays = useMemo<Date[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentWeekStart]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Navigation
  function goToPrevWeek() {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }

  function goToNextWeek() {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }

  function goToToday() {
    setCurrentWeekStart(getWeekStart(new Date()));
  }

  // Week title: "Apr 7 – Apr 13, 2025"
  const weekTitle = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const yearFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
    return `${fmt.format(start)} – ${fmt.format(end)}, ${yearFmt.format(end)}`;
  }, [weekDays]);

  // If no model or no date fields, show empty state
  const dateFields = useMemo(() => (model ? getDateFields(model) : []), [model]);

  if (!model || dateFields.length === 0) {
    return (
      <div className="calendar-empty-state">
        {t('program.calendarNoDateFields')}
      </div>
    );
  }

  const startField = dateFields[0];
  const endField = dateFields.length >= 2 ? dateFields[1] : null;

  // Map: dayIndex (0–6) → programs that appear on that day
  function getProgramsForDay(day: Date): Array<{ program: DataRow; index: number }> {
    const result: Array<{ program: DataRow; index: number }> = [];
    for (let i = 0; i < programs.length; i++) {
      const program = programs[i];
      const startDate = parseDateValue(program[startField.name]);
      if (!startDate) continue;

      if (endField) {
        const endDate = parseDateValue(program[endField.name]);
        if (endDate) {
          if (isInRange(day, startDate, endDate)) {
            result.push({ program, index: i });
          }
          continue;
        }
      }

      // No end field or end date not parseable — just check start date
      if (isSameDay(day, startDate)) {
        result.push({ program, index: i });
      }
    }
    return result;
  }

  return (
    <div>
      {/* Navigation */}
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={goToPrevWeek}>&#8249;</button>
        <button className="calendar-nav-btn" onClick={goToNextWeek}>&#8250;</button>
        <span className="calendar-nav-title">{weekTitle}</span>
        <button className="calendar-nav-today" onClick={goToToday}>Today</button>
      </div>

      {/* Week grid */}
      <div className="calendar-week-grid">
        {weekDays.map((day, dayIndex) => {
          const isToday = isSameDay(day, today);
          const programsOnDay = getProgramsForDay(day);

          return (
            <div
              key={dayIndex}
              className={
                'calendar-week-col' + (isToday ? ' calendar-week-col-today' : '')
              }
            >
              <div className="calendar-week-header">
                <span className="calendar-week-day-label">{DAY_LABELS[dayIndex]}</span>
                <span className="calendar-week-day-num">{day.getDate()}</span>
              </div>
              <div className="calendar-week-body">
                {programsOnDay.map(({ program, index }) => {
                  const tint = TINT_PAIRS[index % TINT_PAIRS.length];
                  const label = String(program.name ?? program.program_id ?? '').trim() || '(unnamed)';
                  return (
                    <button
                      key={String(program.entity_id ?? index)}
                      className="calendar-chip"
                      style={{ backgroundColor: tint.bg, color: tint.text }}
                      onClick={() => onEditProgram(program)}
                      title={label}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
