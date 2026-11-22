import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    // Some checks sweep a whole year against Intl; slow shared runners need more than the 5 s default.
    testTimeout: 60000,
  },
});
