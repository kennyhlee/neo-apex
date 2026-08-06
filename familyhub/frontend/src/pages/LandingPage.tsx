import type { WorkflowStepDef } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';

/**
 * Type-only smoke import — locks the @neoapex/flow-runtime dependency in CI
 * so a broken resolution fails the build. Exported (not just declared) so
 * `noUnusedLocals` doesn't flag it. `RegisterPage`/`HubPage` are the real
 * consumers of `@neoapex/flow-runtime` now (Task 7) -- this page renders
 * nothing but the static explanation copy below.
 */
export type FlowRuntimeSmokeTest = WorkflowStepDef;

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <>
      <h1>FamilyHub</h1>
      <p>{t('landing.explanation')}</p>
    </>
  );
}
