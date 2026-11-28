import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../tests/desktop',
  outputDir: '../test-results/desktop',
  timeout: 80000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    actionTimeout: 12000,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--enable-unsafe-swiftshader'],
    },
  },
});
