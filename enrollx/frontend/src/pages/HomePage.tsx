import type { RegistrationConfigDef } from '@neoapex/flow-runtime';

/**
 * Type-only smoke import — locks the @neoapex/flow-runtime dependency in CI
 * so a broken resolution fails the build. Exported (not just declared) so
 * `noUnusedLocals` doesn't flag it before Plan 4 puts it to real use.
 * Renders nothing yet; Plan 4 replaces this page with the Flow Builder and
 * tracking views.
 */
export type FlowRuntimeSmokeTest = RegistrationConfigDef;

export default function HomePage() {
  return <h1>EnrollX</h1>;
}
