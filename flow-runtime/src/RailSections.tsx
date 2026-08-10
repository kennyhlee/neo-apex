// flow-runtime/src/RailSections.tsx
import { useEffect, useId, useRef, useState } from 'react';
import { useFlowT } from './i18n';
import { SectionShell } from './SectionShell';
import { sectionCompletion } from './sectionCompletion';
import { sectionFields } from './sectionFields';
import { displayTitle } from './sectionTitle';
import type { AccordionSectionsProps } from './AccordionSections';

/**
 * Section rail + scrolling pane. Staff-only, wide screens only -- optimized
 * for an operator transcribing a paper application who needs to jump between
 * sections rather than read top to bottom.
 *
 * Below the breakpoint `FormStep` renders `AccordionSections` instead; this
 * component is never the narrow-screen layout.
 */
export function RailSections(props: AccordionSectionsProps) {
  const { sections, models, draft, renderFields } = props;
  const t = useFlowT();
  const baseId = useId();
  const [activeId, setActiveId] = useState(sections[0]?.section_id ?? '');
  const paneRef = useRef<HTMLDivElement>(null);

  // Scroll-spy via IntersectionObserver rather than scroll-event math.
  // Guarded because jsdom (and very old browsers) lack the API.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !paneRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target instanceof HTMLElement && visible.target.dataset.sectionId) {
          setActiveId(visible.target.dataset.sectionId);
        }
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    paneRef.current.querySelectorAll('[data-section-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const jump = (sectionId: string) => {
    const el = document.getElementById(`${baseId}-${sectionId}`);
    if (!el) return;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActiveId(sectionId);
  };

  return (
    <div className="fr-rail-layout">
      <nav className="fr-rail" aria-label={t('section.nav')}>
        {sections.map((s) => {
          const p = sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft);
          const active = s.section_id === activeId;
          return (
            <button
              key={s.section_id}
              type="button"
              className={`fr-rail-item${active ? ' fr-rail-item--on' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => jump(s.section_id)}
            >
              <span className={`fr-rail-dot${p.done ? ' fr-rail-dot--done' : ''}`} aria-hidden="true" />
              {displayTitle(s)}
            </button>
          );
        })}
      </nav>
      <div className="fr-rail-pane" ref={paneRef}>
        {sections.map((s) => (
          <div key={s.section_id} id={`${baseId}-${s.section_id}`} data-section-id={s.section_id}>
            <SectionShell section={s}>{renderFields(s)}</SectionShell>
          </div>
        ))}
      </div>
    </div>
  );
}
