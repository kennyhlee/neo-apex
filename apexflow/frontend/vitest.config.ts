import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Component tests render JSX, so the React plugin has to run over the test
  // files too. Pure-logic tests are unaffected by it.
  plugins: [react()],
  // Mirrors vite.config.ts. Without it a component test pulls React in twice
  // (once via the app, once via @testing-library/react's own tree) and the
  // second copy has a null dispatcher — see vite.config.ts for the full
  // account of that failure.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    // `node` stays the default: the overwhelming majority of this suite is
    // pure and does not deserve the cost of a DOM. Files that need one opt in
    // per-file with `// @vitest-environment jsdom`.
    environment: 'node',
    // `.tsx` is included deliberately. It was absent, which meant a component
    // test file was silently NEVER COLLECTED — the suite stayed green while
    // testing nothing, which is the worst failure mode a test config has.
    include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/*.test.{ts,tsx}'],
  },
});
