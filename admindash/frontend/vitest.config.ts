import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Component tests render JSX, so the React plugin has to run over the test
  // files too. Pure-logic tests are unaffected by it.
  plugins: [react()],
  // Mirrors vite.config.ts. Without it a component test pulls React in twice
  // (once via the app, once via @testing-library/react's own tree) and the
  // second copy has a null dispatcher.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    // `node` stays the default: most of this suite is pure and does not
    // deserve the cost of a DOM. Files that need one opt in per-file with
    // `// @vitest-environment jsdom`.
    environment: 'node',
    // `.tsx` included deliberately: with `.ts` only, a component test file
    // is silently NEVER COLLECTED and the suite stays green while running
    // none of it.
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/*.test.{ts,tsx}'],
  },
});
