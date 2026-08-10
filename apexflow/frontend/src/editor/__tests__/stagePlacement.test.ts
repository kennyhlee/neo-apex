import { describe, expect, it } from 'vitest';
import { addStepToStage, removeStepFromStage } from '../stagePlacement.ts';
import type { WorkflowStepDef } from '../../types/designer.ts';

function step(step_id: string, available_in: string[]): WorkflowStepDef {
  return {
    step_id,
    type: 'message',
    title: step_id,
    required: false,
    blocking: false,
    available_in,
    show_if: null,
    review: null,
    config: { body: '' },
  };
}

describe('addStepToStage', () => {
  it('adds the stage to a step that already has others', () => {
    const steps = [step('a', ['draft']), step('b', ['pending'])];
    const out = addStepToStage(steps, 'a', 'pending');
    expect(out.find((s) => s.step_id === 'a')?.available_in).toEqual(['draft', 'pending']);
  });

  it('is a no-op when the step already lists the stage', () => {
    const steps = [step('a', ['draft', 'pending'])];
    const out = addStepToStage(steps, 'a', 'pending');
    expect(out.find((s) => s.step_id === 'a')?.available_in).toEqual(['draft', 'pending']);
  });

  it('never changes another step', () => {
    const steps = [step('a', ['draft']), step('b', ['pending'])];
    const out = addStepToStage(steps, 'a', 'pending');
    expect(out.find((s) => s.step_id === 'b')).toEqual(step('b', ['pending']));
  });
});

describe('removeStepFromStage', () => {
  it('removes the stage from a step that has others, and the step survives', () => {
    const steps = [step('a', ['draft', 'pending', 'approved'])];
    const out = removeStepFromStage(steps, 'a', 'pending');
    expect(out.find((s) => s.step_id === 'a')?.available_in).toEqual(['draft', 'approved']);
  });

  it('removing the last stage leaves the step present with an empty available_in, not deleted', () => {
    const steps = [step('a', ['draft'])];
    const out = removeStepFromStage(steps, 'a', 'draft');
    expect(out).toHaveLength(1);
    expect(out[0].step_id).toBe('a');
    expect(out[0].available_in).toEqual([]);
  });

  it('never changes another step', () => {
    const steps = [step('a', ['draft', 'pending']), step('b', ['pending'])];
    const out = removeStepFromStage(steps, 'a', 'pending');
    expect(out.find((s) => s.step_id === 'b')).toEqual(step('b', ['pending']));
  });
});
