import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` included deliberately: with `.ts` only, a component test file
    // is silently NEVER COLLECTED and the suite stays green while running
    // none of it.
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/*.test.{ts,tsx}'],
  },
});
