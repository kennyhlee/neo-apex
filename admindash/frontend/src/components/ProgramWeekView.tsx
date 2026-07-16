import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition } from '../types/models.ts';
import CalendarChip from './CalendarChip.tsx';
import { getDateFields, getWeekStart, getProgramsForDay, isSameDay } from './programWeek.ts';
import './ProgramCalendar.css';

type DataRow = Record<string, unknown>;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ProgramWeekViewProps {
  programs: DataRow[];
  model: ModelDefinition | null;
  onEditProgram: (program: DataRow) => void;
  weekStart?: Date;
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

  // Sync external weekStart prop to internal state
  const externalWeekStart = weekStart;
  useEffect(() => {
    if (externalWeekStart) setCurrentWeekStart(getWeekStart(externalWeekStart));
  }, [externalWeekStart]);

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
          const programsOnDay = getProgramsForDay(programs, day, startField, endField);

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
                {programsOnDay.map(({ program, index }) => (
                  <CalendarChip
                    key={String(program.entity_id ?? index)}
                    program={program}
                    onEdit={onEditProgram}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
