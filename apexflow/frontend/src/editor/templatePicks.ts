import type { WorkflowSectionDef, WorkflowStepDef } from '../types/designer.ts';

/** Picks the tenant's model lacks, removed per section of the matching
 * entity model. Everything else (section ids, modes, repeat, step order,
 * machine) is untouched. Applying a template against an older model is an
 * explicit admin choice (design D6); this is the stripping it names. */
export function stripMissingPicks(steps: WorkflowStepDef[], missing: Record<string, string[]>): WorkflowStepDef[] {
  if (Object.keys(missing).length === 0) return steps;
  return steps.map((step) => {
    if (step.type !== 'form') return step;
    const sections = (step.config?.sections ?? []) as WorkflowSectionDef[];
    return { ...step, config: { ...step.config, sections: sections.map((s) => {
      const drop = new Set(missing[s.entity_model] ?? []);
      return drop.size === 0 ? s : { ...s, fields: s.fields.filter((f) => !drop.has(f.name)) };
    }) } };
  });
}

export function countMissing(missing: Record<string, string[]>): number {
  return Object.values(missing).reduce((n, list) => n + list.length, 0);
}

export function describeMissing(missing: Record<string, string[]>): string {
  return Object.entries(missing).map(([model, fields]) => `${model}: ${fields.join(', ')}`).join('; ');
}
