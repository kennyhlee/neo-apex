import type { RegistrationConfigDef } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';

/**
 * Type-only smoke import — locks the @neoapex/flow-runtime dependency in CI
 * so a broken resolution fails the build. Exported (not just declared) so
 * `noUnusedLocals` doesn't flag it before Plan 5 puts it to real use.
 * Renders nothing yet; Plan 5 replaces this page with the token-scoped
 * registration and application routes.
 */
export type FlowRuntimeSmokeTest = RegistrationConfigDef;

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <>
      <h1>FamilyHub</h1>
      <p>{t('landing.explanation')}</p>
    </>
  );
}
