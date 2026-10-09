import { describe, expect, it } from 'vitest';
import { countMissing, describeMissing, stripMissingPicks } from '../templatePicks.ts';
import type { WorkflowStepDef } from '../../types/designer.ts';

const step = (step_id: string, type: WorkflowStepDef['type'], config: Record<string, unknown>): WorkflowStepDef => ({
  step_id,
  type,
  title: step_id,
  required: true,
  blocking: true,
  available_in: ['parent'],
  config,
});

const STEPS: WorkflowStepDef[] = [
  step('s1', 'form', {
    sections: [
      {
        section_id: 'a',
        entity_model: 'student',
        mode: 'create',
        repeat: { min: 1, max: 3 },
        fields: [
          { name: 'first_name', required: true },
          { name: 'allergies', required: false },
        ],
      },
      {
        section_id: 'b',
        entity_model: 'family',
        mode: 'match_or_create',
        fields: [{ name: 'allergies', required: false }],
      },
    ],
  }),
  step('s2', 'documents', { slots: ['x'] }),
];

describe('stripMissingPicks', () => {
  it('removes listed picks from sections of the matching model only', () => {
    const out = stripMissingPicks(STEPS, { student: ['allergies'] });
    const sections = out[0].config.sections as { fields: { name: string }[] }[];
    expect(sections[0].fields.map((f) => f.name)).toEqual(['first_name']);
    expect(sections[1].fields.map((f) => f.name)).toEqual(['allergies']);
  });

  it('returns the same reference when nothing is missing', () => {
    expect(stripMissingPicks(STEPS, {})).toBe(STEPS);
  });

  it('leaves non-form steps untouched', () => {
    const out = stripMissingPicks(STEPS, { student: ['allergies'] });
    expect(out[1]).toBe(STEPS[1]);
  });

  it('keeps everything else deep-equal and does not mutate the input', () => {
    const snapshot = JSON.parse(JSON.stringify(STEPS));
    const out = stripMissingPicks(STEPS, { student: ['allergies'] });
    expect(STEPS).toEqual(snapshot);
    const expected = JSON.parse(JSON.stringify(STEPS));
    expected[0].config.sections[0].fields = [{ name: 'first_name', required: true }];
    expect(out).toEqual(expected);
  });

  it('keeps a section whose every pick is missing, with fields: []', () => {
    const out = stripMissingPicks(STEPS, { family: ['allergies'] });
    const expected = JSON.parse(JSON.stringify(STEPS));
    expected[0].config.sections[1].fields = [];
    expect(out).toEqual(expected);
    expect((out[0].config.sections as unknown[]).length).toBe(2);
  });
});

describe('countMissing / describeMissing', () => {
  it('counts the total across models', () => {
    expect(countMissing({})).toBe(0);
    expect(countMissing({ student: ['a', 'b'], family: ['c'] })).toBe(3);
  });

  it('describes fields grouped by model', () => {
    expect(describeMissing({ student: ['a', 'b'], family: ['c'] })).toBe('student: a, b; family: c');
  });
});
