import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../../hooks/useTranslation.ts';
import { postQuery } from '../../api/client.ts';
import { PALETTE_EVENT } from './paletteBus.ts';
import './CommandPalette.css';

type Row = Record<string, unknown>;

interface Item {
  id: string;
  group: string;
  label: string;
  detail?: string;
  run: () => void;
}

const DEBOUNCE_MS = 200;
const PER_TYPE = 5;

function esc(v: string): string {
  return v.replace(/'/g, "''");
}

/**
 * ⌘K / Ctrl-K palette — the fast path to a record.
 *
 * Direction A treats this as the primary way in: type a name, land on the
 * record. The nav bar becomes the fallback rather than the route. Available on
 * every page, so it also gives the assistant-less pages a search affordance.
 */
export default function CommandPalette({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  // Resetting lives in the handler rather than an effect, so opening and
  // closing do not trigger a cascading render.
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setCursor(0);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  // Global shortcut. `open` is a dependency so the toggle can branch on the
  // current state directly — doing it inside a setState updater would run
  // close() during the render phase.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else openPalette();
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, openPalette);
    };
  }, [open, close, openPalette]);

  /**
   * Focus management — DOM synchronisation only, no state.
   * Remembers what had focus when the palette opens and hands it back on
   * close, so a keyboard user is not dropped at the top of the document.
   */
  useEffect(() => {
    if (open) {
      restoreFocusTo.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
      return;
    }
    restoreFocusTo.current?.focus?.();
    restoreFocusTo.current = null;
  }, [open]);

  const go = useCallback(
    (to: string, state?: unknown) => {
      close();
      navigate(to, state ? { state } : undefined);
    },
    [navigate, close],
  );

  // Navigation commands are always available and need no network.
  const commands = useMemo<Item[]>(
    () => [
      { id: 'nav-home', group: t('palette.goTo'), label: t('nav.home'), run: () => go('/home') },
      { id: 'nav-leads', group: t('palette.goTo'), label: t('nav.lead'), run: () => go('/leads') },
      { id: 'nav-students', group: t('palette.goTo'), label: t('nav.student'), run: () => go('/students') },
      { id: 'nav-families', group: t('palette.goTo'), label: t('nav.family'), run: () => go('/families') },
      { id: 'nav-programs', group: t('palette.goTo'), label: t('nav.program'), run: () => go('/programs') },
      {
        id: 'act-bulk',
        group: t('palette.actions'),
        label: t('bulkAdd.entryButton'),
        run: () => go('/students/bulk-add'),
      },
    ],
    [t, go],
  );

  // Debounced record search across students, families and programs.
  useEffect(() => {
    const q = query.trim();
    // Stale results are filtered out at render instead of being cleared here,
    // which keeps this effect free of synchronous state updates.
    if (!open || q.length < 2 || !tenant) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      // Flagged only once the request actually fires, not during the debounce.
      setSearching(true);
      const safe = esc(q);
      const searches: Array<Promise<Item[]>> = [
        postQuery(
          tenant,
          'entities',
          `SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' AND (first_name ILIKE '%${safe}%' OR last_name ILIKE '%${safe}%' OR student_id ILIKE '%${safe}%') LIMIT ${PER_TYPE}`,
        )
          .then((r) =>
            (r.data ?? []).map((row: Row) => ({
              id: `s-${String(row.entity_id)}`,
              group: t('nav.student'),
              label:
                [row.first_name, row.last_name].filter(Boolean).join(' ') ||
                String(row.student_id ?? ''),
              detail: String(row.student_id ?? ''),
              run: () => go('/students', { highlightEntityId: String(row.entity_id) }),
            })),
          )
          .catch(() => []),

        postQuery(
          tenant,
          'entities',
          `SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active' AND (family_name ILIKE '%${safe}%' OR primary_email ILIKE '%${safe}%') LIMIT ${PER_TYPE}`,
        )
          .then((r) =>
            (r.data ?? []).map((row: Row) => ({
              id: `f-${String(row.entity_id)}`,
              group: t('nav.family'),
              label: String(row.family_name ?? row.family_id ?? ''),
              detail: String(row.primary_email ?? ''),
              run: () => go('/families'),
            })),
          )
          .catch(() => []),

        postQuery(
          tenant,
          'entities',
          `SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active' AND name ILIKE '%${safe}%' LIMIT ${PER_TYPE}`,
        )
          .then((r) =>
            (r.data ?? []).map((row: Row) => ({
              id: `p-${String(row.entity_id)}`,
              group: t('nav.program'),
              label: String(row.name ?? row.program_id ?? ''),
              detail: String(row.program_id ?? ''),
              run: () => go('/programs'),
            })),
          )
          .catch(() => []),
      ];

      Promise.all(searches)
        .then((sets) => {
          if (cancelled) return;
          setResults(sets.flat().filter((i) => i.label));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, tenant, t, go]);

  const q = query.trim().toLowerCase();
  const visibleCommands = q
    ? commands.filter((c) => c.label.toLowerCase().includes(q))
    : commands;
  // Record results only apply once the query is long enough to have produced
  // them; below that they are stale from a previous keystroke.
  const shownResults = q.length >= 2 ? results : [];
  const items = [...shownResults, ...visibleCommands];
  // Clamp rather than resetting from an effect.
  const activeIndex = Math.min(cursor, Math.max(0, items.length - 1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[activeIndex]?.run();
    }
  }

  if (!open) return null;

  let lastGroup = '';

  return (
    <div
      className="cmdk-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          aria-label={t('palette.title')}
          aria-expanded
          aria-controls="cmdk-list"
          autoComplete="off"
        />

        <ul className="cmdk-list" id="cmdk-list" role="listbox">
          {searching && shownResults.length === 0 && (
            <li className="cmdk-note">{t('common.loading')}</li>
          )}

          {items.length === 0 && !searching && (
            <li className="cmdk-note">
              {query.trim().length < 2 ? t('palette.hint') : t('common.noResults')}
            </li>
          )}

          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`cmdk-item${i === activeIndex ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={item.run}
                >
                  <span className="cmdk-label">{item.label}</span>
                  {item.detail && <span className="cmdk-detail">{item.detail}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="cmdk-foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span>{t('palette.navigate')}</span>
          <kbd>↵</kbd>
          <span>{t('palette.open')}</span>
          <kbd>esc</kbd>
          <span>{t('common.close')}</span>
        </div>
      </div>
    </div>
  );
}
