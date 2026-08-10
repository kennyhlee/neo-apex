import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('labels the nav landmark with the section.nav string, not a bare <nav>', () => {
    const { container } = render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    const nav = container.querySelector('nav');
    expect(nav).toBeTruthy();
    // Matches the 'section.nav' en-US string in i18n.ts verbatim -- if that
    // string or the label wiring regresses, this fails instead of a bare
    // getByRole('navigation') silently matching an unlabeled <nav> too.
    expect(nav!.getAttribute('aria-label')).toBe('Sections');
    // getByRole with a `name` filter is how a screen reader actually
    // resolves the landmark's accessible name -- this must find exactly one.
    // Scoped to this render's own `container` -- RTL auto-cleanup is not
    // wired up in this package's vitest config (no `globals: true`), so an
    // unscoped `screen` query would also match prior tests' still-mounted
    // DOM (existing convention in this test suite).
    expect(within(container).getAllByRole('navigation', { name: 'Sections' }).length).toBe(1);
  });

  it('marks exactly the active rail entry with aria-current, not all or none', () => {
    const { container } = render(<RailSections step={step} sections={sections} models={models}
      draft={{}} onDraftChange={() => {}} renderFields={() => null} />);
    const items = container.querySelectorAll('.fr-rail-item');
    expect(items.length).toBe(2);
    // The rail defaults its active section to sections[0] on mount (no
    // IntersectionObserver entries have fired in jsdom), so the first entry
    // (Student Information) must carry aria-current and the second
    // (Contacts) must not.
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[1].getAttribute('aria-current')).toBeNull();
  });
});
