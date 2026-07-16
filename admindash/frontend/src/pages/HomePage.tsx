import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { postQuery } from '../api/client.ts';
import CalendarChip from '../components/CalendarChip.tsx';
import ProgramDetailModal from '../components/ProgramDetailModal.tsx';
import { timeToMinutes } from '../components/calendarTime.ts';
import {
  getDateFields,
  getWeekDays,
  getProgramsForDay,
  isSameDay,
  type ProgramRow,
} from '../components/programWeek.ts';
import '../components/ProgramCalendar.css';
import './HomePage.css';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface HomePageProps {
  tenant: string;
}

/** Sort same-day programs chronologically by start_time; untimed ones last. */
function byStartTime(a: ProgramRow, b: ProgramRow): number {
  const ma = timeToMinutes(a.start_time);
  const mb = timeToMinutes(b.start_time);
  if (ma === null && mb === null) return 0;
  if (ma === null) return 1;
  if (mb === null) return -1;
  return ma - mb;
}

export default function HomePage({ tenant }: HomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getStudentCount } = useDashboard();
  const { getModel, getCachedModel } = useModel();

  const [studentCount, setStudentCount] = useState<number | null>(null);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [detailProgram, setDetailProgram] = useState<ProgramRow | null>(null);

  useEffect(() => {
    if (!tenant) return;
    getStudentCount(tenant).then(setStudentCount);
  }, [tenant, getStudentCount]);

  // Load the program model (for date-field discovery) then this week's programs.
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;

    async function load() {
      setScheduleLoading(true);
      setModelLoaded(false);

      // Model (for date-field discovery) — failures degrade to the no-fields state.
      await getModel(tenant, 'program').catch(() => undefined);
      if (!cancelled) setModelLoaded(true);

      const sql =
        "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'";
      try {
        const res = await postQuery(tenant, 'entities', sql);
        if (!cancelled) setPrograms((res.data ?? []) as ProgramRow[]);
      } catch {
        if (!cancelled) setPrograms([]);
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tenant, getModel]);

  const model = modelLoaded ? getCachedModel('program') : null;

  // The current week (Mon–Sun) and the programs falling on each day.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weekDays = useMemo(() => getWeekDays(today), [today]);

  const dateFields = useMemo(() => (model ? getDateFields(model) : []), [model]);
  const startField = dateFields[0] ?? null;
  const endField = dateFields.length >= 2 ? dateFields[1] : null;

  const programsByDay = useMemo(() => {
    if (!startField) return weekDays.map(() => [] as ProgramRow[]);
    return weekDays.map((day) =>
      getProgramsForDay(programs, day, startField, endField)
        .map((r) => r.program)
        .sort(byStartTime),
    );
  }, [weekDays, programs, startField, endField]);

  const weekRange = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const yearFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
    return `${fmt.format(weekDays[0])} – ${fmt.format(weekDays[6])}, ${yearFmt.format(weekDays[6])}`;
  }, [weekDays]);

  const hasDateFields = !!startField;
  const totalThisWeek = programsByDay.reduce((n, day) => n + day.length, 0);

  return (
    <div className="home-page">
      <h1>{t('homepage.title')}</h1>

      <div className="home-stats">
        <div className="stat-card">
          <div className="stat-label">{t('homepage.totalStudents')}</div>
          <div className="stat-value purple">{studentCount === null ? '—' : studentCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('homepage.attendanceRate')}</div>
          <div className="stat-value blue">98%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('homepage.programsThisWeek')}</div>
          <div className="stat-value green">{scheduleLoading ? '—' : totalThisWeek}</div>
        </div>
      </div>

      <div className="home-grid">
        <div className="home-card">
          <div className="home-card-header">{t('homepage.quickActions')}</div>
          <div className="home-card-body">
            <div className="shortcut-grid">
              <div className="shortcut-item" onClick={() => navigate('/students')}>
                <span className="shortcut-icon">&#128101;</span>
                <span className="shortcut-label">{t('nav.student')}</span>
              </div>
              <div className="shortcut-item" onClick={() => navigate('/programs')}>
                <span className="shortcut-icon">&#128197;</span>
                <span className="shortcut-label">{t('nav.program')}</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-icon">&#128203;</span>
                <span className="shortcut-label">{t('homepage.viewReports')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-header">{t('homepage.todoItems')}</div>
          <div className="home-card-body">
            <div className="todo-item">
              <div className="todo-bar">
                <div className="todo-bar-fill" style={{ width: '70%', background: 'var(--success)' }} />
              </div>
              <div className="todo-text">Prepare new semester plan</div>
              <div className="todo-date">Due: 2025-10-30</div>
            </div>
            <div className="todo-item">
              <div className="todo-bar">
                <div className="todo-bar-fill" style={{ width: '40%', background: 'var(--warning)' }} />
              </div>
              <div className="todo-text">Update grading system</div>
              <div className="todo-date">Due: 2025-10-28</div>
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-header">{t('homepage.announcements')}</div>
          <div className="home-card-body">
            <div className="announce-item">
              <div className="announce-date">2025-10-20</div>
              <div className="announce-text">Teacher training session on Oct 25 at 2:00 PM in the conference room.</div>
            </div>
            <div className="announce-item">
              <div className="announce-date">2025-10-18</div>
              <div className="announce-text">Holiday schedule adjustment for November — check email for details.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="schedule-card">
        <div className="schedule-header">
          <span className="schedule-title">{t('homepage.weeklySchedule')}</span>
          <span className="schedule-week-range">{weekRange}</span>
          <button className="schedule-viewall" onClick={() => navigate('/programs')}>
            {t('homepage.viewAllPrograms')}
          </button>
        </div>
        <div className="schedule-body">
          {scheduleLoading ? (
            <div className="schedule-empty">{t('common.loading')}</div>
          ) : !hasDateFields ? (
            <div className="schedule-empty">{t('homepage.scheduleNoDateFields')}</div>
          ) : totalThisWeek === 0 ? (
            <div className="schedule-empty">{t('homepage.scheduleNoPrograms')}</div>
          ) : (
            <div className="schedule-days">
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={idx}
                    className={'schedule-day-header' + (isToday ? ' schedule-day-header-today' : '')}
                  >
                    <span className="schedule-day-label">{DAY_LABELS[idx]}</span>
                    <span className="schedule-day-num">{day.getDate()}</span>
                  </div>
                );
              })}
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                const dayPrograms = programsByDay[idx];
                return (
                  <div
                    key={idx}
                    className={'schedule-day-cell' + (isToday ? ' schedule-day-cell-today' : '')}
                  >
                    {dayPrograms.map((program, i) => (
                      <CalendarChip
                        key={String(program.entity_id ?? program.program_id ?? `${idx}-${i}`)}
                        program={program}
                        onEdit={setDetailProgram}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ProgramDetailModal
        program={detailProgram}
        model={model ?? null}
        onClose={() => setDetailProgram(null)}
      />
    </div>
  );
}
