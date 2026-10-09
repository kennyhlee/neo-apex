// Click-to-locate for the validation rail: turn one of `validate.py`'s error
// strings into the place in the Stages tab that produced it, and take the
// author there.
//
// Same contract `validationMatch.ts` relies on — every message names its ids
// as single-quoted literals (`step '{id}'`, `section '{id}'`,
// `field '{name}'`, `state '{id}'`) — plus one message that names no section
// at all: the unconditional coverage rule, `model '{m}' required field '{f}'
// is not included+required by any unconditional section`. Its fix is a pick
// in a section on that model, so it is sent to the FIRST unconditional
// section bound to `m` (the one the editor's `syncModelRequiredFields` locks
// the field into), or nowhere if the workflow has none.
//
// Ids are only ever targets once checked against the definition on screen:
// many messages exist precisely because they name something that is NOT
// there (`undeclared section 'x'`), and a click that scrolls to nothing is
// worse than an error that does not look clickable.
import { revealStage } from './flow/revealStage.ts';
import type { WorkflowSectionDef, WorkflowStepDef } from '../types/designer.ts';

/** Anchors the reveal looks up. Read by `revealErrorTarget`, written by
 * StepEditor (step card), SectionPanel (panel) and its field table (row). */
export const STEP_ANCHOR_ATTR = 'data-step-anchor';
export const SECTION_ANCHOR_ATTR = 'data-section-anchor';
export const FIELD_ANCHOR_ATTR = 'data-field-anchor';
/** Transient highlight on whatever the reveal lands on (editor.css). */
export const ERROR_TARGET_FLASH_CLASS = 'error-target-flash';
const FLASH_MS = 2000;

export interface ErrorTarget {
  stepId?: string;
  sectionId?: string;
  field?: string;
  stageId?: string;
}

function quoted(err: string, label: string): string | undefined {
  // Non-greedy up to the next quote: ids never contain one in practice, and
  // the f-strings never escape, so this is exactly as precise as the
  // messages themselves.
  return new RegExp(`${label} '([^']*)'`).exec(err)?.[1];
}

function sectionsOf(step: WorkflowStepDef): WorkflowSectionDef[] {
  const raw = step.config?.sections;
  return Array.isArray(raw) ? (raw as WorkflowSectionDef[]) : [];
}

function owningStep(steps: WorkflowStepDef[], sectionId: string): WorkflowStepDef | undefined {
  return steps.find((s) => sectionsOf(s).some((sec) => sec.section_id === sectionId));
}

/** Where `err` points in the given definition, or `null` if it names nothing
 * that is currently on the page. */
export function errorTarget(err: string, steps: WorkflowStepDef[], stateIds: string[]): ErrorTarget | null {
  const coverage = /^model '([^']*)' required field '([^']*)'/.exec(err);
  if (coverage) {
    const [, model, field] = coverage;
    for (const step of steps) {
      if (step.show_if) continue;
      const section = sectionsOf(step).find((sec) => sec.entity_model === model);
      if (section) return { stepId: step.step_id, sectionId: section.section_id, field };
    }
    return null;
  }

  // A section-PREFIXED message is about that section (its parenthesised
  // step is only context). Anywhere else, `section '…'` is a reference the
  // subject makes — e.g. a step's show_if pointing at a section — and the
  // subject is what needs editing.
  if (err.startsWith("section '")) {
    const sectionId = quoted(err, 'section')!;
    const step = owningStep(steps, sectionId);
    if (!step) return null;
    const field = quoted(err, 'field');
    return field
      ? { stepId: step.step_id, sectionId, field }
      : { stepId: step.step_id, sectionId };
  }

  const stepId = quoted(err, 'step');
  if (stepId !== undefined && steps.some((s) => s.step_id === stepId)) return { stepId };

  const stateId = quoted(err, 'state');
  if (stateId !== undefined && stateIds.includes(stateId)) return { stageId: stateId };

  return null;
}

/** First element whose `attr` equals `value` exactly. Compared in JS rather
 * than through an attribute selector: ids are authored strings, and quoting
 * one into a selector is how an id with a quote in it throws. */
function byAttr(root: ParentNode, attr: string, value: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    if (el.getAttribute(attr) === value) return el;
  }
  return null;
}

/** One frame — long enough for React to commit the render a click caused. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function land(el: HTMLElement, doc: Document) {
  if (typeof el.scrollIntoView === 'function') {
    const reduced =
      typeof doc.defaultView?.matchMedia === 'function' &&
      doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }
  // Focus as well as scroll, so a keyboard user lands where they clicked to
  // go; a row is not focusable by default, hence the programmatic tabindex.
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.classList.remove(ERROR_TARGET_FLASH_CLASS);
  el.classList.add(ERROR_TARGET_FLASH_CLASS);
  setTimeout(() => el.classList.remove(ERROR_TARGET_FLASH_CLASS), FLASH_MS);
}

/**
 * Take the author to `target` on the Stages tab: the field row if it is on
 * screen, else its section, else its step. A collapsed step is expanded
 * first (through its own toggle, the same as a click would) since its body
 * is not rendered until then. Resolves false when nothing could be found.
 */
export async function revealErrorTarget(target: ErrorTarget, doc: Document = document): Promise<boolean> {
  if (target.stageId) return revealStage(target.stageId, doc);
  if (!target.stepId) return false;

  const stepEl = byAttr(doc, STEP_ANCHOR_ATTR, target.stepId);
  if (!stepEl) return false;

  const toggle = stepEl.querySelector<HTMLElement>('.step-collapse-toggle');
  if (target.sectionId && toggle?.getAttribute('aria-expanded') === 'false') {
    toggle.click();
    await nextFrame();
  }

  const sectionEl = target.sectionId ? byAttr(stepEl, SECTION_ANCHOR_ATTR, target.sectionId) : null;
  const fieldEl = sectionEl && target.field ? byAttr(sectionEl, FIELD_ANCHOR_ATTR, target.field) : null;
  land(fieldEl ?? sectionEl ?? stepEl, doc);
  return true;
}
