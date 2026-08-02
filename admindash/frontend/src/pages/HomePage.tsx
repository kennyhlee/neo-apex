import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { listLeads, postQuery } from '../api/client.ts';
import { leadStages } from '../utils/leadModel.ts';
import { stageTone } from '../utils/tone.ts';
import type { Lead } from '../types/models.ts';
import CalendarChip from '../components/CalendarChip.tsx';
import ProgramDetailModal from '../components/ProgramDetailModal.tsx';
import { ChatPanel } from '../components/ChatPanel';
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
const STALE_DAYS = 7;

interface HomePageProps {
  tenant: string;
}

interface QueueItem {
  key: string;
  count: number;
  label: string;
  detail?: string;
  action: string;
  tone: 'danger' | 'attn' | 'ok';
  onAct: () => void;
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

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

export default function HomePage({ tenant }: HomePageProps) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getStudentCount } = useDashboard();
  const { getModel, getCachedModel } = useModel();

  const [studentCount, setStudentCount] = useState<number | null>(null);
  const [familyCount, setFamilyCount] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [detailProgram, setDetailProgram] = useState<ProgramRow | null>(null);

  useEffect(() => {
    if (!tenant) return;
    getStudentCount(tenant).then(setStudentCount);
  }, [tenant, getStudentCount]);

  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    postQuery(
      tenant,
      'entities',
      "SELECT COUNT(*) as count FROM data WHERE entity_type = 'family' AND _status = 'active'",
    )
      .then((res) => {
        if (!cancelled) setFamilyCount(Number(res.data[0]?.count ?? 0));
      })
      .catch(() => {
        if (!cancelled) setFamilyCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant]);

  // Leads drive both the pipeline spine and the work queue.
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    getModel(tenant, 'lead').catch(() => undefined);
    listLeads(tenant)
      .then((rows) => {
        if (!cancelled) setLeads(rows);
      })
      .catch(() => {
        if (!cancelled) setLeads([]);
      })
      .finally(() => {
        if (!cancelled) setLeadsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, getModel]);

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

      const sql = "SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'";
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
  const leadModel = getCachedModel('lead');
  const stages = useMemo(() => leadStages(leadModel), [leadModel]);

  // --- Pipeline ------------------------------------------------------------
  const stageCounts = useMemo(() => {
    const known = new Set(stages);
    const counts = stages.map((stage) => ({
      stage,
      count: leads.filter((l) => l.stage === stage).length,
    }));
    const other = leads.filter((l) => l.stage && !known.has(l.stage)).length;
    if (other > 0) counts.push({ stage: t('leads.otherStage'), count: other });
    return counts;
  }, [leads, stages, t]);

  const convertedCount = leads.filter((l) => l.converted_family_id).length;
  const openInquiries = leads.filter((l) => !l.converted_family_id).length;

  // --- Work queue ----------------------------------------------------------
  const queue = useMemo<QueueItem[]>(() => {
    if (!leadsLoaded || leads.length === 0) return [];

    const firstStage = stages[0];
    const lastStage = stages[stages.length - 1];
    const open = leads.filter((l) => !l.converted_family_id);

    const untouched = open.filter((l) => l.stage === firstStage);
    const unreachable = open.filter((l) => !l.email && !l.phone);
    const stale = open.filter((l) => {
      if (l.stage === lastStage) return false;
      const age = daysSince(l._created_at);
      return age !== null && age > STALE_DAYS;
    });
    // The final two stages are where a lead has committed but no family record
    // exists yet — the conversion is the work that is outstanding.
    const advanced = new Set(stages.slice(Math.max(0, stages.length - 2), stages.length - 1));
    const readyToConvert = open.filter((l) => advanced.has(l.stage));

    /** Oldest age in a group, for the line that says why it is urgent. */
    const oldest = (rows: Lead[]): number | null => {
      const ages = rows.map((l) => daysSince(l._created_at)).filter((a): a is number => a != null);
      return ages.length ? Math.max(...ages) : null;
    };

    /** "1 day" and "4 days" need different strings; there is no plural support. */
    const days = (n: number, oneKey: string, manyKey: string) =>
      (n === 1 ? t(oneKey) : t(manyKey)).replace('{n}', String(n));

    const untouchedAge = oldest(untouched);
    const staleAge = oldest(stale);

    const items: QueueItem[] = [
      {
        key: 'untouched',
        count: untouched.length,
        label: t('today.unassignedLeads'),
        // How long the oldest has been sitting ranks this better than a hue.
        detail:
          untouchedAge != null
            ? days(untouchedAge, 'today.oldestWaitingOne', 'today.oldestWaiting')
            : undefined,
        action: t('today.unassignedLeadsAction'),
        // Deliberately not `danger`: an inquiry awaiting a first call is
        // routine backlog, not a fault. Red is kept for genuine problems so
        // it still means something when it appears.
        tone: 'attn',
        onAct: () => navigate('/leads'),
      },
      {
        key: 'stale',
        count: stale.length,
        label: t('today.staleLeads'),
        detail:
          staleAge != null
            ? days(staleAge, 'today.longestWaitingOne', 'today.longestWaiting')
            : undefined,
        action: t('today.staleLeadsAction'),
        tone: 'attn',
        onAct: () => navigate('/leads'),
      },
      {
        key: 'unreachable',
        count: unreachable.length,
        // This counts inquiries with no email and no phone — the old label
        // said "students missing required details", naming the wrong entity.
        label: t('today.unreachableLeads'),
        detail: t('today.unreachableLeadsDetail'),
        action: t('today.unreachableLeadsAction'),
        tone: 'attn',
        onAct: () => navigate('/leads'),
      },
      {
        key: 'convert',
        count: readyToConvert.length,
        label: t('today.readyToEnroll'),
        detail: t('today.readyToEnrollDetail'),
        action: t('today.readyToEnrollAction'),
        tone: 'ok',
        onAct: () => navigate('/leads'),
      },
    ];

    return items.filter((i) => i.count > 0);
  }, [leads, leadsLoaded, stages, navigate, t]);

  // --- Week ----------------------------------------------------------------
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

  // Dates now follow the selected locale rather than being pinned to en-US.
  const weekRange = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const yearFmt = new Intl.DateTimeFormat(locale, { year: 'numeric' });
    return `${fmt.format(weekDays[0])} – ${fmt.format(weekDays[6])}, ${yearFmt.format(weekDays[6])}`;
  }, [weekDays, locale]);

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date()),
    [locale],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t('today.greetingMorning');
    if (h < 18) return t('today.greetingAfternoon');
    return t('today.greetingEvening');
  }, [t]);

  const hasDateFields = !!startField;
  const totalThisWeek = programsByDay.reduce((n, day) => n + day.length, 0);

  // --- Public inquiry link (previously reachable from nowhere) --------------
  const inquiryUrl = `${window.location.origin}/inquire/${tenant}`;
  const copyInquiryLink = useCallback(() => {
    navigator.clipboard
      .writeText(inquiryUrl)
      .then(() => toast({ message: t('today.copied'), tone: 'success' }))
      .catch(() =>
        toast({
          message: t('today.copyLink'),
          detail: inquiryUrl,
          tone: 'neutral',
          duration: 12000,
        }),
      );
  }, [inquiryUrl, toast, t]);

  const [chatOpen, setChatOpen] = useState(true);
  // Let the shell reclaim the centered gutter so content meets the drawer with
  // no dead gap while the assistant is open. Scoped to Home via cleanup.
  useEffect(() => {
    document.body.classList.toggle('assistant-open', chatOpen);
    return () => document.body.classList.remove('assistant-open');
  }, [chatOpen]);

  return (
    <div className={`home-layout ${chatOpen ? 'chat-open' : ''}`}>
      <button
        className="home-chat-toggle"
        onClick={() => setChatOpen((o) => !o)}
        aria-expanded={chatOpen}
      >
        {chatOpen ? 'Hide assistant ›' : '‹ Assistant'}
      </button>
      <aside className={`home-chat-drawer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <ChatPanel />
      </aside>

      <div className="home-page">
        <header className="today-head">
          <h1 className="page-title">
            {greeting}
            <span className="page-subtitle">{todayLabel}</span>
          </h1>
        </header>

        {/* ---- Needs you today ------------------------------------------- */}
        <section className="today-section" aria-labelledby="today-queue-h">
          <h2 className="today-section-title" id="today-queue-h">
            {t('today.needsYou')}
          </h2>

          {!leadsLoaded ? (
            <div className="queue-grid">
              {[0, 1].map((i) => (
                <div key={i} className="queue-card queue-card-skeleton" aria-hidden="true">
                  <span className="queue-skel-n" />
                  <span className="queue-skel-line" />
                </div>
              ))}
            </div>
          ) : queue.length === 0 ? (
            <div className="today-clear">
              <strong>{t('today.allClear')}</strong>
              <span>{t('today.allClearBody')}</span>
            </div>
          ) : (
            <div className="queue-grid">
              {queue.map((item) => (
                <div key={item.key} className={`queue-card queue-${item.tone}`}>
                  <span className="queue-count">{item.count}</span>
                  <span className="queue-text">
                    <strong>{item.label}</strong>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={item.onAct}>
                    {item.action}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Pipeline --------------------------------------------------- */}
        <section className="today-section" aria-labelledby="today-pipeline-h">
          <div className="today-section-head">
            <h2 className="today-section-title" id="today-pipeline-h">
              {t('today.pipeline')}
            </h2>
            <button type="button" className="btn btn-link" onClick={() => navigate('/leads')}>
              {t('today.viewAll')}
            </button>
          </div>

          {stages.length === 0 ? (
            <p className="today-muted">{t('today.noStages')}</p>
          ) : (
            <ol className="spine">
              {stageCounts.map((s, i) => (
                <li
                  key={s.stage}
                  className="spine-stage"
                  style={
                    { '--stage-c': `var(--${stageTone(i, stageCounts.length)})` } as React.CSSProperties
                  }
                >
                  <b>{leadsLoaded ? s.count : '—'}</b>
                  <span>{s.stage}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ---- This week -------------------------------------------------- */}
        <section className="today-section" aria-labelledby="today-week-h">
          <h2 className="today-section-title" id="today-week-h">
            {t('today.thisWeek')}
          </h2>
          <div className="tile-grid">
            <button type="button" className="tile" onClick={() => navigate('/students')}>
              <span className="tile-n">{studentCount === null ? '—' : studentCount}</span>
              <span className="tile-l">{t('today.students')}</span>
            </button>
            <button type="button" className="tile" onClick={() => navigate('/families')}>
              <span className="tile-n">{familyCount === null ? '—' : familyCount}</span>
              <span className="tile-l">{t('today.families')}</span>
            </button>
            <button type="button" className="tile" onClick={() => navigate('/programs')}>
              <span className="tile-n">{scheduleLoading ? '—' : totalThisWeek}</span>
              <span className="tile-l">{t('today.programsThisWeek')}</span>
            </button>
            <button type="button" className="tile" onClick={() => navigate('/leads')}>
              <span className="tile-n">{leadsLoaded ? openInquiries : '—'}</span>
              <span className="tile-l">
                {t('today.openInquiries')}
                {leadsLoaded && convertedCount > 0 ? (
                  <small>
                    {convertedCount} {t('today.families').toLowerCase()}
                  </small>
                ) : null}
              </span>
            </button>
          </div>
        </section>

        {/* ---- Weekly schedule -------------------------------------------- */}
        <section className="schedule-card" aria-labelledby="today-schedule-h">
          <div className="schedule-header">
            <span className="schedule-title" id="today-schedule-h">
              {t('homepage.weeklySchedule')}
            </span>
            <span className="schedule-week-range">{weekRange}</span>
            <button type="button" className="btn btn-link" onClick={() => navigate('/programs')}>
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
        </section>

        {/* ---- Public inquiry link ----------------------------------------
             The lead-capture form has always existed at /inquire/:tenantId but
             nothing in the product linked to it, so no school could share it. */}
        <section className="inquiry-card" aria-labelledby="today-inquiry-h">
          <div className="inquiry-text">
            <h2 id="today-inquiry-h">{t('today.inquiryLink')}</h2>
            <p>{t('today.inquiryLinkBody')}</p>
            <code className="inquiry-url">{inquiryUrl}</code>
          </div>
          <button type="button" className="btn btn-secondary" onClick={copyInquiryLink}>
            {t('today.copyLink')}
          </button>
        </section>

        <ProgramDetailModal
          program={detailProgram}
          model={model ?? null}
          onClose={() => setDetailProgram(null)}
        />
      </div>
    </div>
  );
}
