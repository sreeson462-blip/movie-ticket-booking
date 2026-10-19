import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // All test files share one database, so run files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/movies_test',
      JWT_SECRET: 'test-secret',
      BCRYPT_ROUNDS: '4',
    },
  },
});
