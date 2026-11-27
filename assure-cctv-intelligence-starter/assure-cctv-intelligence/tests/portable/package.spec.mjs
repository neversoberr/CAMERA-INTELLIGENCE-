import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installLiveWall } from '../live-wall.mjs';

let dir, pageURL, example;
test.beforeAll(async () => {
  const zip = unzipSync(await readFile(new URL('../../public/downloads/Framewatch-PC.zip', import.meta.url)));
  dir = await mkdtemp(join(tmpdir(), 'Framewatch PC '));
  for (const name of ['Framewatch.html', 'Example camera grid.webp']) {
    await writeFile(join(dir, name), zip[name]);
  }
  pageURL = pathToFileURL(join(dir, 'Framewatch.html')).href;
  example = join(dir, 'Example camera grid.webp');
});
test.afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test('the extracted HTML analyses the supplied screenshot without a server or network', async ({ context, page }) => {
  const remote = [];
  context.on('request', req => { if (/^https?:/.test(req.url())) remote.push(req.url()); });
  await page.goto(pageURL);
  await expect(page.getByRole('heading', { name: 'Occupancy monitor' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Framewatch home' })).toHaveAttribute('href', pageURL);
  await page.getByLabel('Open camera screenshot').setInputFiles(example);
  await expect(page.locator('.fw-source-tag')).toHaveText('Screenshot');
  await expect(page.locator('.fw-engine-stats')).toContainText('24 model passes');
  await expect(page.locator('.fw-results-foot')).toContainText('Checked');
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied', 'Empty', 'Occupied', 'Empty']);
  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await expect(page.locator('.fw-camera-name strong')).toHaveText(['Camera 02', 'Camera 04']);
  await page.getByRole('button', { name: 'All views' }).click();
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.locator('.fw-engine-stats')).toContainText('20 model passes');
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied', 'Empty', 'Occupied', 'Empty']);
  await page.getByRole('link', { name: 'Vacancy dashboard', exact: true }).click();
  await expect(page.getByText('No empty periods observed yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Name places' })).toBeDisabled();
  expect(remote).toEqual([]);
});

test('a file-origin user gesture can start display capture, update results, and stop', async ({ page }) => {
  await page.goto(pageURL);
  await page.getByRole('button', { name: 'Share screen' }).click();
  await expect(page.locator('.fw-source-tag')).toHaveText('Screen share');
  const status = page.locator('.fw-results-foot');
  await expect(status).toContainText('Checked');
  const first = await status.textContent();
  await expect(status).not.toHaveText(first);
  await expect(status).toContainText('Checked');
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(page.locator('.fw-source-tag')).toHaveText('Sample');
});


test('offline PC history uses real live checks, stops and reopens at the last observation', async ({page,context}) => {
  const remote=[]; context.on('request', r=>{ if(/^https?:/.test(r.url())) remote.push(r.url()); });
  await page.goto(pageURL); await installLiveWall(page);
  await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button',{name:'Share screen'}).click();
  await expect(page.locator('.fw-engine-stats')).toContainText('12 model passes');
  await page.getByRole('link',{name:'Vacancy dashboard',exact:true}).click();
  const rows=page.locator('.fw-log-table tbody tr'); await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'Stop sharing'}).click(); await expect(rows.first()).toContainText('Monitoring ended');
  const times=()=>rows.locator('time').evaluateAll(times=>times.map(t=>t.dateTime)); const before=await times();
  await page.reload(); await expect(rows).toHaveCount(2); expect(await times()).toEqual(before);
  await expect(page.getByRole('button',{name:'Share screen'})).toBeVisible(); expect(remote).toEqual([]);
});

test('the PC copy can give and disable a live reminder offline without a desktop notification API', async ({page, context}) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'Notification', { configurable: true, value: undefined }); });
  const remote=[]; context.on('request', r=>{ if(/^https?:/.test(r.url())) remote.push(r.url()); });
  await page.goto(pageURL); await installLiveWall(page);
  await page.getByRole('button',{name:'Fast',exact:true}).click(); await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('link',{name:'Reminders',exact:true}).click(); await page.getByRole('switch',{name:'Empty-cabin reminders'}).click();
  await expect(page.getByRole('button',{name:'Enable desktop notifications'})).toBeDisabled(); await expect(page.getByText('Not available here')).toBeVisible();
  // Return to the wall: switches between views must not tear down the reminder listener.
  await page.getByRole('link',{name:'View monitor'}).click(); await page.getByRole('button',{name:'Share screen'}).click();
  const alert=page.getByLabel('Vacancy reminder',{exact:true}); await expect(alert).toContainText('2 places observed empty'); await expect(alert).toContainText('Camera 01, Camera 02');
  await page.getByRole('link',{name:'Reminders',exact:true}).click(); await page.getByRole('switch',{name:'Empty-cabin reminders'}).click(); await expect(alert).toHaveCount(0);
  await page.getByRole('button',{name:'Stop sharing'}).click(); await page.reload(); await expect(page.getByRole('switch',{name:'Empty-cabin reminders'})).not.toBeChecked();
  expect(remote).toEqual([]);
});
