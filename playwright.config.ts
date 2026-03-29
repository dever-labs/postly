import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // Electron tests are not browser-based — no projects needed
  reporter: [['list'], ['html', { open: 'never' }]],
  // Run tests serially — one Electron instance at a time
  workers: 1,
  use: {
    actionTimeout: 10_000,
  },
})
