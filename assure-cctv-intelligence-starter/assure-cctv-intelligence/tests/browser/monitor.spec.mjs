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

test('Detailed locates a small person in the correct camera and fuses overlapping crop boxes', async ({ page }) => {
  await page.goto('/');
  // Controlled small-target regression: composite a scaled figure from the
  // supplied synthetic reception into the second (otherwise empty) corridor.
  const png = await page.evaluate(async () => {
    const img = new Image(); img.src = '/demo/camera-wall.webp'; await img.decode();
    const c = document.createElement('canvas'); c.width = 1600; c.height = 450;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    for (const x of [0, 800]) ctx.drawImage(img, 800,450,800,450, x,0,800,450);
    ctx.drawImage(img,347,25,110,273, 1177,207,60*110/273,60);
    return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('Open camera screenshot').setInputFiles({ name: 'small-person.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(states(page)).toHaveText(['Empty','Occupied']);
  await expect(page.locator('.fw-engine-stats')).toContainText('10 model passes');
  const boxes = page.locator('.fw-tile').nth(1).locator('.fw-person-box');
  await expect(boxes).toHaveCount(1);
  const box = await boxes.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  expect(Math.abs(box.x - 47)).toBeLessThan(4); expect(Math.abs(box.y - 46)).toBeLessThan(4);
});

test('real worker invalidates cached labels on entry, loss of signal and layout reset', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const worker = new Worker('/occupancy/worker.js');
    try {
      const img = new Image(); img.src = '/demo/camera-wall.webp'; await img.decode();
      const c = document.createElement('canvas'); c.width = 800; c.height = 450;
      const ctx = c.getContext('2d', { alpha: false, willReadFrequently: true });
      async function run(cam, token, reset = false) {
        if (cam === -1) ctx.fillRect(0,0,800,450); else ctx.drawImage(img,cam*800,0,800,450,0,0,800,450);
        const frame = await createImageBitmap(c);
        return await new Promise((resolve, reject) => {
          worker.onmessage = e => resolve(e.data); worker.onerror = e => reject(new Error(e.message));
          worker.postMessage({ frame, cols: 1, rows: 1, mode: 'fast', live: true, frameToken: token, reset }, [frame]);
        });
      }
      await run(1,0); // load and warm the model
      const empty = await run(1,1,true), reused = await run(1,2), person = await run(0,3);
      const miss = await run(1,4), repeat = await run(1,4), confirmed = await run(1,5);
      const blank = await run(-1,6), back = await run(0,7), reset = await run(1,8,true);
      return [empty,reused,person,miss,repeat,confirmed,blank,back,reset].map(r=>[r.readings[0].state,r.readings[0].boxes.length,r.stats.inferences]);
    } finally { worker.terminate(); }
  });
  expect(results.map(r=>r[0])).toEqual(['empty','empty','occupied','unclear','unclear','empty','unclear','occupied','empty']);
  expect(results[1][2]).toBe(0); expect(results[2][2]).toBe(1); expect(results[3][1]).toBe(0);
});
