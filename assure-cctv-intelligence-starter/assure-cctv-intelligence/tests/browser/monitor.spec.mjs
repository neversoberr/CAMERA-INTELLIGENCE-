import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const wall = fileURLToPath(new URL('../../public/demo/camera-wall.webp', import.meta.url));
const expected = ['Occupied', 'Empty', 'Occupied', 'Empty'];
const states = page => page.locator('.fw-camera-list .fw-status');

test('checks a local image, filters the result and rechecks a cropped grid', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open camera screenshot').setInputFiles(wall);
  await expect(page.locator('.fw-source-tag')).toHaveText('Screenshot');
  await expect(states(page)).toHaveText(expected);
  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await expect(page.locator('.fw-camera-name strong')).toHaveText(['Camera 02', 'Camera 04']);
  await page.getByRole('button', { name: 'All views' }).click();
  await page.getByRole('button', { name: 'Crop to camera grid' }).click();
  await page.getByText('Set margins by percentage').click();
  await page.getByLabel('Right', { exact: true }).fill('50');
  await page.getByLabel('Bottom', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await page.getByLabel('Camera grid: columns by rows').selectOption('1x1');
  await expect(states(page)).toHaveText(['Occupied']);
});

test('a detector failure never means empty and can be retried', async ({ context, page }) => {
  const model = '**/models/efficientdet-lite0.tflite';
  await context.route(model, route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.goto('/');
  await page.getByLabel('Open camera screenshot').setInputFiles(wall);
  await expect(page.getByRole('button', { name: 'Retry analysis' })).toBeVisible();
  await expect(states(page)).toHaveText(Array(4).fill('Unclear'));
  await context.unroute(model);
  await page.getByRole('button', { name: 'Retry analysis' }).click();
  await expect(states(page)).toHaveText(expected);
});

test('a shared MediaStream is rechecked and its track is released on stop', async ({ page }) => {
  await page.goto('/');
  // Substitute only the interactive OS picker. The stream, video, worker and
  // person detector are real; no machine display or camera permissions are needed.
  await page.evaluate(async () => {
    const img = new Image(); img.src = '/demo/camera-wall.webp'; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async ({ audio }) => {
      if (audio !== false) throw new Error('Unexpected audio capture');
      const stream = canvas.captureStream(2); window.testTrack = stream.getVideoTracks()[0];
      window.blankStream = () => ctx.fillRect(0, 0, canvas.width, canvas.height);
      requestAnimationFrame(() => ctx.drawImage(img, 0, 0)); return stream;
    } });
  });
  await page.getByRole('button', { name: 'Share screen' }).click();
  await expect(page.locator('.fw-source-tag')).toHaveText('Screen share');
  await expect(states(page)).toHaveText(expected);
  await page.evaluate(() => window.blankStream());
  await expect(states(page)).toHaveText(Array(4).fill('Unclear'));
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(page.locator('.fw-source-tag')).toHaveText('Sample');
  expect(await page.evaluate(() => window.testTrack.readyState)).toBe('ended');
});
