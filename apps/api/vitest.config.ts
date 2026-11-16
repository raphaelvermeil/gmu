import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // One local database is shared, so test files run one at a time.
    fileParallelism: false,
  },
});
