import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SectionShell } from '../SectionShell';
import type { WorkflowSectionDef } from '../types';

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [],
    mode: 'create',
    ...over,
  };
}

/**
 * Guards the whole reason this component exists: without a real
 * `fieldset`/`legend` pair, a screen reader announces three identical
 * "First name" fields with nothing distinguishing them (see SectionShell's
 * own doc comment). These tests assert the ELEMENT STRUCTURE, not just
 * that the title text appears somewhere -- a `<div>` containing the same
 * text would satisfy a text-only assertion but not the a11y guarantee.
 */
describe('SectionShell — fieldset/legend structure', () => {
  it('renders a fieldset whose first element child is a legend', () => {
    const { container } = render(
      <SectionShell section={section()}>
        <input aria-label="First name" />
      </SectionShell>,
    );

    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset?.tagName).toBe('FIELDSET');

    const legend = fieldset?.querySelector('legend');
    expect(legend).not.toBeNull();
    expect(legend?.tagName).toBe('LEGEND');
    // Must be the fieldset's own direct legend, not merely somewhere
    // inside it -- this is what makes it the accessible name for the
    // group per the fieldset/legend HTML contract.
    expect(legend?.parentElement).toBe(fieldset);
  });

  it("the legend's text equals displayTitle(section), including the humanized fallback", () => {
    // No authored `title` -> humanizeSectionId('student_section') -> 'Student'.
    const { container: noTitle } = render(
      <SectionShell section={section()}>
        <input aria-label="First name" />
      </SectionShell>,
    );
    expect(noTitle.querySelector('legend')?.textContent).toBe('Student');

    // Authored `title` wins over the humanized fallback.
    const { container: withTitle } = render(
      <SectionShell section={section({ title: 'Student Information' })}>
        <input aria-label="First name" />
      </SectionShell>,
    );
    expect(withTitle.querySelector('legend')?.textContent).toBe('Student Information');
  });

  it('renders fields inside the fieldset, not as siblings of it', () => {
    const { container } = render(
      <SectionShell section={section()}>
        <input aria-label="First name" data-testid="first-name-field" />
      </SectionShell>,
    );

    const fieldset = container.querySelector('fieldset');
    const field = container.querySelector('[data-testid="first-name-field"]');
    expect(fieldset).not.toBeNull();
    expect(field).not.toBeNull();
    // contains() is true for the fieldset itself too, so also assert the
    // field is a strict descendant, not the fieldset itself.
    expect(fieldset?.contains(field)).toBe(true);
    expect(field).not.toBe(fieldset);
    // And explicitly NOT a sibling: the field's closest fieldset ancestor
    // must be this one.
    expect(field?.closest('fieldset')).toBe(fieldset);
  });
});
