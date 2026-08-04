import type { RegistrationConfigDef } from '@neoapex/flow-runtime';
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';

/**
 * Type-only smoke import — locks the @neoapex/flow-runtime dependency in CI
 * so a broken resolution fails the build. Exported (not just declared) so
 * `noUnusedLocals` doesn't flag it before Plan 4 puts it to real use.
 * Renders nothing yet; Plan 4 replaces this page with the Flow Builder and
 * tracking views.
 */
export type FlowRuntimeSmokeTest = RegistrationConfigDef;

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <>
      <h1>EnrollX</h1>
      {/* Plan 4 replaces this with a real Navbar; until then this is the
          only authenticated nav surface. Do not rename/remove — Plan 4 is
          expected to preserve this link when it lands. */}
      <nav>
        <Link to="/settings/payments">{t('nav.payments')}</Link>
      </nav>
    </>
  );
}
