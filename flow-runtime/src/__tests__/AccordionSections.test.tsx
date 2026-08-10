import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { AccordionSections } from '../AccordionSections';
import type { ModelFieldSource } from '../blockConfig';
import type { WorkflowSectionDef, WorkflowStepDef } from '../types';
import type { WorkflowDraft } from '../StepRenderer';

// jsdom does not implement window.matchMedia, and useMediaQuery (used
// elsewhere in the FormStep tree) will throw if it's called against an
// undefined matchMedia. AccordionSections itself doesn't call the hook, but
// stub it defensively so this suite doesn't become a landmine for whoever
// next renders it through FormStep.
beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [{ name: 'first_name', required: true }],
    mode: 'create',
    ...over,
  };
}

const step: WorkflowStepDef = {
  step_id: 'step1',
  type: 'form',
  title: 'Details',
  required: true,
  blocking: true,
  available_in: [],
  config: {},
};

const models: Record<string, ModelFieldSource> = {
  student: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
};

function renderFields(s: WorkflowSectionDef) {
  return <div data-testid={`fields-${s.section_id}`}>{s.section_id} fields</div>;
}

describe('AccordionSections — initial open state', () => {
  const sections = [
    section({ section_id: 'student_section' }),
    section({ section_id: 'contacts_section' }),
  ];

  it('opens the first incomplete section and leaves the rest closed', () => {
    const draft: WorkflowDraft = { 'student_section.first_name': 'Mai' };
    const { container } = render(
      <AccordionSections step={step} sections={sections} models={models} draft={draft}
        onDraftChange={() => {}} renderFields={renderFields} />,
    );

    const buttons = container.querySelectorAll('button.fr-accordion-btn');
    expect(buttons).toHaveLength(2);
    // student_section is complete -> collapsed; contacts_section is
    // incomplete -> the first incomplete section, so it's open.
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('opens nothing when every section is already complete', () => {
    const draft: WorkflowDraft = {
      'student_section.first_name': 'Mai',
      'contacts_section.first_name': 'Ana',
    };
    const { container } = render(
      <AccordionSections step={step} sections={sections} models={models} draft={draft}
        onDraftChange={() => {}} renderFields={renderFields} />,
    );

    const buttons = container.querySelectorAll('button.fr-accordion-btn');
    expect(buttons).toHaveLength(2);
    for (const button of Array.from(buttons)) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('opens nothing when every section has no required fields (all optional)', () => {
    const optionalSections = [
      section({ section_id: 'a_section', fields: [{ name: 'nickname', required: false }] }),
      section({ section_id: 'b_section', fields: [{ name: 'nickname', required: false }] }),
    ];
    const { container } = render(
      <AccordionSections step={step} sections={optionalSections} models={{
        student: { base_fields: [{ name: 'nickname', type: 'str', required: false }], custom_fields: [] },
      }} draft={{}} onDraftChange={() => {}} renderFields={renderFields} />,
    );

    const buttons = container.querySelectorAll('button.fr-accordion-btn');
    expect(buttons).toHaveLength(2);
    for (const button of Array.from(buttons)) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });
});

describe('AccordionSections — collapsed content stays mounted', () => {
  const sections = [
    section({ section_id: 'student_section' }),
    section({ section_id: 'contacts_section' }),
  ];

  it('keeps the collapsed panel in the DOM behind the hidden attribute', () => {
    const draft: WorkflowDraft = { 'student_section.first_name': 'Mai' };
    const { container } = render(
      <AccordionSections step={step} sections={sections} models={models} draft={draft}
        onDraftChange={() => {}} renderFields={renderFields} />,
    );

    // student_section is complete, so it's the collapsed one -- its panel
    // (and the field content inside it) must still be present in the DOM,
    // just hidden, so browser find-in-page/print can still reach it.
    const collapsedFields = container.querySelector('[data-testid="fields-student_section"]');
    expect(collapsedFields).not.toBeNull();

    const panel = collapsedFields?.closest('.fr-accordion-panel');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('hidden')).toBe(true);

    // The open section's panel, by contrast, carries no hidden attribute.
    const openFields = container.querySelector('[data-testid="fields-contacts_section"]');
    const openPanel = openFields?.closest('.fr-accordion-panel');
    expect(openPanel).not.toBeNull();
    expect(openPanel?.hasAttribute('hidden')).toBe(false);
  });
});
