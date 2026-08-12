import { describe, it, expect } from 'vitest';
import { displayTitle, humanizeSectionId } from '../sectionTitle';
import type { WorkflowSectionDef } from '../types';

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [{ name: 'first_name', required: true }],
    mode: 'create',
    ...over,
  };
}

describe('humanizeSectionId', () => {
  it('strips a trailing _section and capitalizes', () => {
    expect(humanizeSectionId('student_section')).toBe('Student');
    expect(humanizeSectionId('contacts_section')).toBe('Contacts');
  });

  it('handles ids without the suffix', () => {
    expect(humanizeSectionId('emergency_contacts')).toBe('Emergency contacts');
  });

  it('falls back to the raw id when nothing is left', () => {
    expect(humanizeSectionId('_section')).toBe('_section');
  });
});

describe('displayTitle', () => {
  it('prefers an authored title', () => {
    expect(displayTitle(section({ title: 'Student Information' }))).toBe('Student Information');
  });

  it('falls back when the title is absent, blank, or whitespace', () => {
    expect(displayTitle(section())).toBe('Student');
    expect(displayTitle(section({ title: '' }))).toBe('Student');
    expect(displayTitle(section({ title: '   ' }))).toBe('Student');
  });
});
