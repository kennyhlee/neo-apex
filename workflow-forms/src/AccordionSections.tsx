// workflow-forms/src/AccordionSections.tsx
import { useId, useMemo, useState } from 'react';
import { useFlowT } from './i18n';
import { SectionShell } from './SectionShell';
import { sectionCompletion } from './sectionCompletion';
import { sectionFields } from './sectionFields';
import { displayTitle } from './sectionTitle';
import type { ModelFieldSource } from './blockConfig';
import type { WorkflowDraft } from './StepRenderer';
import type { WorkflowSectionDef, WorkflowStepDef } from './types';

export interface AccordionSectionsProps {
  step: WorkflowStepDef;
  sections: WorkflowSectionDef[];
  models: Record<string, ModelFieldSource>;
  draft: WorkflowDraft;
  onDraftChange: (next: WorkflowDraft) => void;
  renderFields: (section: WorkflowSectionDef) => React.ReactNode;
}

/**
 * Collapsible sections with per-section completion state. Used by the family
 * flow, the designer preview, and staff below 700px.
 *
 * Collapsed panels stay MOUNTED behind the `hidden` attribute rather than
 * being unmounted, so browser find-in-page and print still reach them -- the
 * standard objection to accordions on long forms.
 */
export function AccordionSections(props: AccordionSectionsProps) {
  const { sections, models, draft, renderFields } = props;
  const t = useFlowT();
  const baseId = useId();

  const progress = useMemo(
    () => sections.map((s) => sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft)),
    [sections, models, draft],
  );

  // Open the first INCOMPLETE section; when everything is done, open nothing
  // and let the form read as a finished checklist. Computed once on mount --
  // recomputing as the parent types would yank panels open under them.
  const [openId, setOpenId] = useState<string | null>(() => {
    const first = sections.findIndex(
      (s) => !sectionCompletion(s, sectionFields(s, models[s.entity_model]), draft).done,
    );
    return first === -1 ? null : sections[first].section_id;
  });

  return (
    <div className="fr-accordion">
      {sections.map((section, i) => {
        const open = openId === section.section_id;
        const p = progress[i];
        const panelId = `${baseId}-${section.section_id}-panel`;
        const pill = p.optional
          ? { cls: 'fr-pill--optional', text: t('section.optional') }
          : p.done
            ? { cls: 'fr-pill--done', text: t('section.done') }
            : { cls: 'fr-pill--todo', text: t('section.remaining').replace('{n}', String(p.remaining)) };

        return (
          <div className="fr-accordion-item" key={section.section_id}>
            <h3 className="fr-accordion-h">
              <button
                type="button"
                className="fr-accordion-btn"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? null : section.section_id)}
              >
                <span className={`fr-pill ${pill.cls}`}>{pill.text}</span>
                <span className="fr-accordion-t">{displayTitle(section)}</span>
                <span className="fr-accordion-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
                <span className="fr-sr-only">
                  {open ? t('section.collapse') : t('section.expand')}
                </span>
              </button>
            </h3>
            <div id={panelId} className="fr-accordion-panel" hidden={!open}>
              <SectionShell section={section} showLegend={false}>
                {renderFields(section)}
              </SectionShell>
            </div>
          </div>
        );
      })}
    </div>
  );
}
