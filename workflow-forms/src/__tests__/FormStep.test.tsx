// workflow-forms/src/__tests__/FormStep.test.tsx
//
// Layout selection is `FormStep`'s job (inside `StepRenderer.tsx`), but
// `FormStep` itself is not exported -- these tests drive it through the
// public `StepRenderer` component, same as a real host would. This closes
// the gap the final whole-branch review found: the spec's own testing
// table ("staff+wide -> rail; staff+narrow -> accordion; family/preview ->
// accordion") had no test anywhere in the branch.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StepRenderer, type StepRendererMode } from '../StepRenderer';
import type { ModelFieldSource } from '../blockConfig';
import type { WorkflowSectionDef, WorkflowStepDef } from '../types';

// jsdom does not implement window.matchMedia; useMediaQuery reads it via
// both a useState initializer and an effect, so the stub must be in place
// before render() for the initial value to reflect it.
function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function twoSectionStep(): WorkflowStepDef {
  const sections: WorkflowSectionDef[] = [
    {
      section_id: 'student_section', entity_model: 'student', mode: 'create',
      fields: [{ name: 'first_name', required: true }],
    },
    {
      section_id: 'contacts_section', entity_model: 'contact', mode: 'create',
      fields: [{ name: 'first_name', required: true }],
    },
  ];
  return {
    step_id: 'application_form', type: 'form', title: 'Application',
    required: true, blocking: true, available_in: ['draft'], config: { sections },
  };
}

const models: Record<string, ModelFieldSource> = {
  student: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
  contact: { base_fields: [{ name: 'first_name', type: 'str', required: true }], custom_fields: [] },
};

function renderStep(mode: StepRendererMode, wide: boolean) {
  stubMatchMedia(wide);
  return render(
    <StepRenderer
      steps={[twoSectionStep()]}
      models={models}
      mode={mode}
      draft={{}}
      onDraftChange={() => {}}
    />,
  );
}

describe('FormStep — layout selection', () => {
  it('staff + wide screen -> the rail layout, not the accordion', () => {
    const { container } = renderStep('staff', true);
    expect(container.querySelector('.fr-rail')).not.toBeNull();
    expect(container.querySelector('.fr-accordion')).toBeNull();
  });

  it('staff + narrow screen -> the accordion, not the rail', () => {
    const { container } = renderStep('staff', false);
    expect(container.querySelector('.fr-accordion')).not.toBeNull();
    expect(container.querySelector('.fr-rail')).toBeNull();
  });

  it('family, even on a wide screen -> the accordion, never the staff rail', () => {
    const { container } = renderStep('family', true);
    expect(container.querySelector('.fr-accordion')).not.toBeNull();
    expect(container.querySelector('.fr-rail')).toBeNull();
  });

  it('preview, even on a wide screen -> the accordion, never the staff rail', () => {
    const { container } = renderStep('preview', true);
    expect(container.querySelector('.fr-accordion')).not.toBeNull();
    expect(container.querySelector('.fr-rail')).toBeNull();
  });
});

describe('FormStep — single-section step', () => {
  it('still wraps its one section in SectionShell (fieldset/legend), not bare fields', () => {
    const sections: WorkflowSectionDef[] = [
      {
        section_id: 'student_section', entity_model: 'student', mode: 'create',
        title: 'Student Information',
        fields: [{ name: 'first_name', required: true }],
      },
    ];
    const step: WorkflowStepDef = {
      step_id: 'application_form', type: 'form', title: 'Application',
      required: true, blocking: true, available_in: ['draft'], config: { sections },
    };
    stubMatchMedia(false);
    const { container } = render(
      <StepRenderer
        steps={[step]}
        models={models}
        mode="family"
        draft={{}}
        onDraftChange={() => {}}
      />,
    );
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    const legend = fieldset?.querySelector('legend');
    expect(legend).not.toBeNull();
    expect(legend?.parentElement).toBe(fieldset);
    expect(legend?.textContent).toBe('Student Information');
    // Neither multi-section layout should appear for a single section.
    expect(container.querySelector('.fr-accordion')).toBeNull();
    expect(container.querySelector('.fr-rail')).toBeNull();
  });
});
