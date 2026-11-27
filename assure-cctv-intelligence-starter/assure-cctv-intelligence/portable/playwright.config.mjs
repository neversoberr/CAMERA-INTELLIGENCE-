import { defineConfig } from '@playwright/test';

// Deliberately no webServer or baseURL. Test exactly what a user extracts, in
// a normal file-origin security context, with all network access switched off.
export default defineConfig({
  testDir: '../tests/portable', outputDir: '../test-results/pc',
  timeout: 60000, expect: { timeout: 30000 }, workers: 1,
  use: { offline: true, launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Synthetic screen + picker for automated QA only; not part of the package.
    args: ['--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  } },
});
