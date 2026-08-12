// workflow-forms/src/sectionTitle.ts
import type { WorkflowSectionDef } from './types';

/**
 * `student_section` -> `Student`. Strips a trailing `_section` (every
 * authored section_id in the enrollment template carries it), swaps
 * underscores for spaces, and capitalizes the first letter.
 *
 * This is the fallback that lets a definition authored before section copy
 * existed still render a meaningful heading with no admin edit.
 */
export function humanizeSectionId(id: string): string {
  const words = id.replace(/_section$/, '').replace(/_/g, ' ').trim();
  if (words === '') return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The heading every layout renders for a section. */
export function displayTitle(section: WorkflowSectionDef): string {
  const authored = (section.title ?? '').trim();
  return authored !== '' ? authored : humanizeSectionId(section.section_id);
}
