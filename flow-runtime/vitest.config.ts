import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom, not node: Task 4 renders a React component.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
