import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Run integration test files sequentially — each file spawns a Mockly
    // binary on dynamically allocated ports. Parallel forks cause port
    // TOCTOU races and resource contention on CI runners.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
  },
})
