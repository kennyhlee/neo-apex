import { describe, it, expect } from 'vitest';
import { sectionCompletion } from '../sectionCompletion';
import type { FlowField, WorkflowSectionDef } from '../types';

const F = (name: string, required: boolean): FlowField =>
  ({ name, type: 'str', required } as FlowField);

function section(over: Partial<WorkflowSectionDef> = {}): WorkflowSectionDef {
  return {
    section_id: 'student_section',
    entity_model: 'student',
    fields: [],
    mode: 'create',
    ...over,
  };
}

describe('sectionCompletion — non-repeat', () => {
  const fields = [F('first_name', true), F('last_name', true), F('nickname', false)];

  it('counts required fields only', () => {
    const p = sectionCompletion(section(), fields, {});
    expect(p.required).toBe(2);
    expect(p.remaining).toBe(2);
    expect(p.done).toBe(false);
  });

  it('an optional answer does not reduce remaining', () => {
    const p = sectionCompletion(section(), fields, { 'student_section.nickname': 'Bo' });
    expect(p.remaining).toBe(2);
  });

  it('is done when every required field is answered', () => {
    const p = sectionCompletion(section(), fields, {
      'student_section.first_name': 'Mai',
      'student_section.last_name': 'Nguyen',
    });
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
  });

  it('treats empty string, null, undefined and [] as unanswered', () => {
    for (const empty of ['', null, undefined, []]) {
      const p = sectionCompletion(section(), [F('a', true)], { 'student_section.a': empty });
      expect(p.remaining, JSON.stringify(empty)).toBe(1);
    }
  });

  it('treats false as an ANSWER, not a blank', () => {
    // an unchecked required checkbox is a deliberate "no" -- matches how the
    // backend's as_bool reads a flattened "false".
    const p = sectionCompletion(section(), [F('agrees', true)], { 'student_section.agrees': false });
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
  });

  it('treats 0 as an answer', () => {
    const p = sectionCompletion(section(), [F('siblings', true)], { 'student_section.siblings': 0 });
    expect(p.done).toBe(true);
  });
});

describe('sectionCompletion — no required fields', () => {
  it('is done and flagged optional', () => {
    const p = sectionCompletion(section(), [F('nickname', false)], {});
    expect(p.required).toBe(0);
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);
    expect(p.optional).toBe(true);
  });

  it('a section with required fields is not optional', () => {
    expect(sectionCompletion(section(), [F('a', true)], {}).optional).toBe(false);
  });
});

describe('sectionCompletion — repeat', () => {
  const s = section({ section_id: 'contacts_section', repeat: { min: 1, max: 5 } });
  const fields = [F('first_name', true), F('phone', false)];

  it('is not done when fewer than min rows exist', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [] });
    expect(p.done).toBe(false);
  });

  it('is not done when a present row is missing a required field', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [{ phone: '555' }] });
    expect(p.done).toBe(false);
    expect(p.remaining).toBe(1);
  });

  it('is done when min rows exist and each is complete', () => {
    const p = sectionCompletion(s, fields, { contacts_section: [{ first_name: 'Ana' }] });
    expect(p.done).toBe(true);
  });

  it('sums remaining across rows', () => {
    const p = sectionCompletion(s, fields, {
      contacts_section: [{ first_name: 'Ana' }, {}, {}],
    });
    expect(p.remaining).toBe(2);
  });

  it('treats a missing draft key as zero rows', () => {
    expect(sectionCompletion(s, fields, {}).done).toBe(false);
  });
});
