// workflow-forms/src/SectionShell.tsx
import type { ReactNode } from 'react';
import { SectionDescription } from './SectionDescription';
import { displayTitle } from './sectionTitle';
import type { WorkflowSectionDef } from './types';

export interface SectionShellProps {
  section: WorkflowSectionDef;
  /** Rendered inside the fieldset -- normally the section's field grid. */
  children: ReactNode;
  /** When false, the legend is visually hidden but stays in the a11y tree
   *  (the enclosing layout is already showing the title in its own header). */
  showLegend?: boolean;
}

/**
 * The grouping wrapper EVERY layout uses. This -- not the visual treatment --
 * is what fixes the enrollment form's ambiguity: `student_section` and
 * `contacts_section` both declare `first_name`, and without a fieldset/legend
 * a screen reader announces three identical "First name" fields with nothing
 * distinguishing them. `legend` makes it "Student Information, First name".
 *
 * A layout that renders fields without this component reintroduces the bug.
 */
export function SectionShell({ section, children, showLegend = true }: SectionShellProps) {
  return (
    <fieldset className="fr-section">
      <legend className={showLegend ? 'fr-section-title' : 'fr-sr-only'}>
        {displayTitle(section)}
      </legend>
      <SectionDescription markdown={section.description} />
      {children}
    </fieldset>
  );
}
