// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  ERROR_TARGET_FLASH_CLASS,
  FIELD_ANCHOR_ATTR,
  SECTION_ANCHOR_ATTR,
  STEP_ANCHOR_ATTR,
  errorTarget,
  revealErrorTarget,
} from '../errorTarget.ts';
import type { WorkflowStepDef } from '../../types/designer.ts';

const step = (
  step_id: string,
  sections: { section_id: string; entity_model: string }[],
  show_if: WorkflowStepDef['show_if'] = undefined,
): WorkflowStepDef => ({
  step_id,
  type: 'form',
  title: step_id,
  required: true,
  blocking: true,
  available_in: ['draft'],
  show_if,
  config: {
    sections: sections.map((s) => ({ ...s, mode: 'create', repeat: null, fields: [] })),
  },
});

const STEPS: WorkflowStepDef[] = [
  step('maybe', [{ section_id: 'extra', entity_model: 'registration_application' }], {
    all: [{ source: 'context.x', op: 'truthy' }],
  }),
  step('apply', [
    { section_id: 'student_section', entity_model: 'student' },
    { section_id: 'application_section', entity_model: 'registration_application' },
  ]),
];
const STATES = ['draft', 'submitted'];

describe('errorTarget', () => {
  it('sends a model coverage error to the field in the first UNCONDITIONAL section on that model', () => {
    // The prod report's exact message.
    const err =
      "model 'registration_application' required field 'school_year' is not included+required by any unconditional section";
    expect(errorTarget(err, STEPS, STATES)).toEqual({
      stepId: 'apply',
      sectionId: 'application_section',
      field: 'school_year',
    });
  });

  it('targets a section-prefixed error at its section, carrying the field it names', () => {
    const err =
      "section 'extra' (step 'maybe', conditional) includes model-required field 'school_year' — conditional sections may only include model-optional fields";
    expect(errorTarget(err, STEPS, STATES)).toEqual({ stepId: 'maybe', sectionId: 'extra', field: 'school_year' });
  });

  it('resolves the owning step of a section error that does not name one', () => {
    expect(errorTarget("section 'student_section' title is too long", STEPS, STATES)).toEqual({
      stepId: 'apply',
      sectionId: 'student_section',
    });
  });

  it('targets a step error at the step, not at a section it merely mentions', () => {
    const err =
      "step 'apply' show_if references 'ghost.x' — field 'x' does not exist on section 'ghost' (model 'student')";
    expect(errorTarget(err, STEPS, STATES)).toEqual({ stepId: 'apply' });
  });

  it('targets a state error at its stage', () => {
    expect(errorTarget("state 'submitted' is unreachable from the initial state", STEPS, STATES)).toEqual({
      stageId: 'submitted',
    });
  });

  it('returns null when nothing named exists to go to', () => {
    expect(errorTarget("transition 't9' commit_sections references undeclared section 'nope'", STEPS, STATES)).toBeNull();
    expect(errorTarget('no initial state', STEPS, STATES)).toBeNull();
    expect(errorTarget("model 'contact' required field 'phone' is not included+required by any unconditional section", STEPS, STATES)).toBeNull();
  });
});

describe('revealErrorTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** A step card shaped like StepEditor's: a collapse toggle, and a body that
   * only exists while expanded — the toggle rebuilds it, as React would. */
  function mountStep(collapsed: boolean) {
    const li = document.createElement('li');
    li.setAttribute(STEP_ANCHOR_ATTR, 'apply');
    const toggle = document.createElement('button');
    toggle.className = 'step-collapse-toggle';
    const body = () => {
      const panel = document.createElement('div');
      panel.setAttribute(SECTION_ANCHOR_ATTR, 'application_section');
      const row = document.createElement('tr');
      row.setAttribute(FIELD_ANCHOR_ATTR, 'school_year');
      panel.appendChild(row);
      return panel;
    };
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'true');
      li.appendChild(body());
    });
    li.appendChild(toggle);
    if (!collapsed) li.appendChild(body());
    document.body.appendChild(li);
  }

  const target = { stepId: 'apply', sectionId: 'application_section', field: 'school_year' };

  it('lands on the field row, focused and flashed', async () => {
    mountStep(false);
    expect(await revealErrorTarget(target)).toBe(true);
    const row = document.querySelector(`[${FIELD_ANCHOR_ATTR}]`) as HTMLElement;
    expect(document.activeElement).toBe(row);
    expect(row.classList.contains(ERROR_TARGET_FLASH_CLASS)).toBe(true);
  });

  it('expands a collapsed step before looking for the field', async () => {
    mountStep(true);
    expect(await revealErrorTarget(target)).toBe(true);
    expect(document.activeElement?.getAttribute(FIELD_ANCHOR_ATTR)).toBe('school_year');
  });

  it('falls back to the section when the field row is absent', async () => {
    mountStep(false);
    expect(await revealErrorTarget({ ...target, field: 'not_rendered' })).toBe(true);
    expect(document.activeElement?.getAttribute(SECTION_ANCHOR_ATTR)).toBe('application_section');
  });

  it('matches authored ids literally, quotes and spaces included', async () => {
    const li = document.createElement('li');
    li.setAttribute(STEP_ANCHOR_ATTR, `it's a "step"`);
    document.body.appendChild(li);
    expect(await revealErrorTarget({ stepId: `it's a "step"` })).toBe(true);
    expect(document.activeElement).toBe(li);
  });

  it('reports false when the target is not on the page', async () => {
    expect(await revealErrorTarget({ stepId: 'gone' })).toBe(false);
  });
});
