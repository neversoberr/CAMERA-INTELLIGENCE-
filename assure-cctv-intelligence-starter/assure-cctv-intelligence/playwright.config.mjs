import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: { timeout: 30000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--enable-unsafe-swiftshader'], // headless CI only: allow software WebGL
  } },
  webServer: {
    command: 'npm run dev -- --hostname 0.0.0.0 --port 3000',
    url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
