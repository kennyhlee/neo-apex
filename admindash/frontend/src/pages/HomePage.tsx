import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useToast } from '../hooks/useToast.ts';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useAttention } from '../hooks/useAttention.ts';
import { listLeads, postQuery } from '../api/client.ts';
import { leadStages } from '../utils/leadModel.ts';
import { stageTone } from '../utils/tone.ts';
import { ageDays, bucketRows } from '../utils/attentionData.ts';
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

interface HomePageProps {
  tenant: string;
}

interface QueueItem {
  key: string;
  count: number;
  label: string;
  detail?: string;
  action: string;
  tone: 'danger' | 'attn';
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

export default function HomePage({ tenant }: HomePageProps) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getStudentCount } = useDashboard();
  const { getModel, getCachedModel } = useModel();
  const attention = useAttention(tenant);

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

  // Leads drive the pipeline spine and the "This week" inquiry tile. The work
  // queue is workflow-sourced — see useAttention.
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
  /** "1 day" and "4 days" need different strings; there is no plural support. */
  const days = useCallback(
    (n: number, oneKey: string, manyKey: string) =>
      (n === 1 ? t(oneKey) : t(manyKey)).replace('{n}', String(n)),
    [t],
  );

  const queue = useMemo<QueueItem[]>(() => {
    const result = attention.result;
    if (!result) return [];

    /** The largest age in a bucket, or null when no row in it has one. */
    const worst = (bucket: 'overdue' | 'review' | 'stalled'): number | null => {
      const ages = bucketRows(result, bucket)
        .map((r) => r.ageMs)
        .filter((a): a is number => a !== null);
      return ages.length ? Math.max(...ages) : null;
    };

    const detail = (bucket: 'overdue' | 'review' | 'stalled', one: string, many: string) => {
      const ms = worst(bucket);
      if (ms === null) return undefined;
      return days(ageDays(ms), one, many);
    };

    const items: QueueItem[] = [
      {
        key: 'overdue',
        count: bucketRows(result, 'overdue').length,
        label: t('today.overdue'),
        detail: detail('overdue', 'today.overdueDetailOne', 'today.overdueDetail'),
        action: t('today.overdueAction'),
        // A missed deadline is a genuine fault, which is what `danger` is
        // reserved for — see the tone comment in HomePage.css.
        tone: 'danger',
        onAct: () => navigate('/attention?bucket=overdue'),
      },
      {
        key: 'review',
        count: bucketRows(result, 'review').length,
        label: t('today.review'),
        detail: detail('review', 'today.reviewDetailOne', 'today.reviewDetail'),
        action: t('today.reviewAction'),
        // Deliberately not `danger`: a queue of work awaiting review is
        // routine backlog, not a fault. Red stays meaningful that way.
        tone: 'attn',
        onAct: () => navigate('/attention?bucket=review'),
      },
      {
        key: 'stalled',
        count: bucketRows(result, 'stalled').length,
        label: t('today.stalled'),
        detail: detail('stalled', 'today.stalledDetailOne', 'today.stalledDetail'),
        action: t('today.stalledAction'),
        tone: 'attn',
        onAct: () => navigate('/attention?bucket=stalled'),
      },
    ];

    return items.filter((i) => i.count > 0);
  }, [attention.result, navigate, t, days]);

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

  // Focus is handed to the handle AFTER the close has rendered: below 992px the
  // handle is `display: none` while open, and `.focus()` on a still-hidden
  // element is a silent no-op.
  const reopenRef = useRef<HTMLButtonElement>(null);
  const wantReopenFocus = useRef(false);
  useEffect(() => {
    if (!chatOpen && wantReopenFocus.current) {
      wantReopenFocus.current = false;
      reopenRef.current?.focus();
    }
  }, [chatOpen]);

  const closeChat = useCallback(() => {
    // The element that had focus is inside the panel about to be hidden
    // (`visibility: hidden` when `aria-hidden`), so parking focus on the
    // reopen control keeps a keyboard user where the assistant now is.
    wantReopenFocus.current = true;
    setChatOpen(false);
  }, []);

  /**
   * Escape closes the drawer when focus is inside it. Bound to the `<aside>`
   * rather than to `document`: a window-level listener would also fire while
   * the user is typing in some unrelated control on Home, and closing the
   * assistant out from under an edit elsewhere is worse than not offering the
   * shortcut. React's synthetic events bubble, so focus in any descendant is
   * covered.
   */
  const onDrawerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeChat();
    },
    [closeChat],
  );

  return (
    <div className="home-layout">
      {/* The drawer's own edge handle, not page chrome. Closed it is a thin
          tab at the viewport edge; open it rides flush against the drawer's
          left edge on the same 0.28s, so the two read as one object. It
          outranks the drawer — at a lower z-index the open panel painted over
          its own toggle, which is how this control became unclickable before. */}
      <button
        ref={reopenRef}
        className={`home-chat-toggle ${chatOpen ? 'is-open' : ''}`}
        onClick={() => setChatOpen((o) => !o)}
        aria-expanded={chatOpen}
        aria-controls="home-chat-drawer"
      >
        <span className="home-chat-toggle__chevron" aria-hidden="true">&#8249;</span>
        <span className="home-chat-toggle__label">{t('assistant.title')}</span>
      </button>
      <aside
        id="home-chat-drawer"
        className={`home-chat-drawer ${chatOpen ? 'is-open' : ''}`}
        aria-hidden={!chatOpen}
        onKeyDown={onDrawerKeyDown}
      >
        <ChatPanel onClose={closeChat} />
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
          <div className="today-section-head">
            <h2 className="today-section-title" id="today-queue-h">
              {t('today.needsYou')}
            </h2>
            {queue.length > 0 && (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => navigate('/attention')}
              >
                {t('today.seeAll').replace(
                  '{n}',
                  String(queue.reduce((n, i) => n + i.count, 0)),
                )}
              </button>
            )}
          </div>

          {!attention.loaded ? (
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

          {attention.loaded && Object.values(attention.failed).some(Boolean) && (
            <p className="today-muted" role="status">
              {t('today.queuePartial')}{' '}
              <button type="button" className="btn btn-link" onClick={attention.reload}>
                {t('common.retry')}
              </button>
            </p>
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
