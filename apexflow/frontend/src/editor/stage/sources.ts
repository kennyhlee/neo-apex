// The three picker menus GuardEffectComposer needs: declared section ids
// (`commit_sections.section_ids`), declared step ids (`start_due_clocks`,
// `items_in_status`), and the `{section_id}.{field}` source groups a
// `data_condition` guard's ShowIfBuilder offers.
//
// These existed as module-private helpers in MachineEditor.tsx, which Task 10
// deletes. They are a real module now rather than a copy: StepEditor.tsx has
// its own `buildSourceGroups` for step `show_if`, and having a third copy
// appear alongside the one that is about to be deleted is exactly the
// duplication a reviewer should reject.
import type { SourceGroup } from '../ShowIfBuilder.tsx';
import type { WorkflowSectionDef, WorkflowStepDef } from '../../types/designer.ts';

function getSections(step: WorkflowStepDef): WorkflowSectionDef[] {
  const raw = step.config.sections;
  return Array.isArray(raw) ? (raw as WorkflowSectionDef[]) : [];
}

export function declaredSectionIds(steps: WorkflowStepDef[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (section.section_id) ids.push(section.section_id);
    }
  }
  return ids;
}

export function declaredStepIds(steps: WorkflowStepDef[]): string[] {
  return steps.map((s) => s.step_id);
}

export function buildSourceGroups(steps: WorkflowStepDef[], contextLabel: string): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of getSections(step)) {
      if (!section.entity_model || section.fields.length === 0) continue;
      groups.push({
        label: section.section_id,
        options: section.fields.map((f) => ({
          value: `${section.section_id}.${f.name}`,
          label: `${section.section_id}.${f.name}`,
        })),
      });
    }
  }
  // Behaviour-preserving extraction from MachineEditor.tsx:65-110: this
  // hardcodes `context.school_year`, which is wrong for the signup template
  // (whose context key is `program_id`). Leave it wrong here — widening it
  // is a behaviour change that belongs in its own task with its own test,
  // not smuggled into an extraction.
  groups.push({
    label: contextLabel,
    options: [{ value: 'context.school_year', label: 'context.school_year' }],
  });
  return groups;
}
