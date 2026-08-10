import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RailSections } from '../RailSections';
import type { WorkflowSectionDef, WorkflowStepDef } from '../types';

const step: WorkflowStepDef = {
  step_id: 'application_form', type: 'form', title: 'Application',
  required: true, blocking: true, available_in: ['draft'], config: {},
} as WorkflowStepDef;

const sections: WorkflowSectionDef[] = [
  { section_id: 'student_section', entity_model: 'student', mode: 'create',
    title: 'Student Information', fields: [{ name: 'first_name', required: true }] },
  { section_id: 'contacts_section', entity_model: 'contact', mode: 'create',
    fields: [{ name: 'first_name', required: true }] },
];

const models = {
  student: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
  contact: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
} as never;

beforeEach(() => {
  // jsdom has no IntersectionObserver; the rail must not crash without it.
  (globalThis as never as { IntersectionObserver: unknown }).IntersectionObserver =
    class { observe() {} unobserve() {} disconnect() {} } as never;
});

describe('RailSections', () => {
  it('renders a nav entry per section, using the title fallback', () => {
    render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeTruthy();
    expect(nav.textContent).toContain('Student Information');
    expect(nav.textContent).toContain('Contacts');   // humanized fallback
  });

  it('renders every section in the pane, not just the active one', () => {
    const { container } = render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    expect(container.querySelectorAll('fieldset').length).toBe(2);
  });
});
