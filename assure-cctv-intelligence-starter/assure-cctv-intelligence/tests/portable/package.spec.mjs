import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
  await expect(page.locator('.fw-results-foot')).toContainText('Checked');
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied', 'Empty', 'Occupied', 'Empty']);
  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await expect(page.locator('.fw-camera-name strong')).toHaveText(['Camera 02', 'Camera 04']);
  await page.getByRole('button', { name: 'All views' }).click();
  await page.getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.locator('.fw-engine-stats')).toContainText('20 model passes');
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied', 'Empty', 'Occupied', 'Empty']);
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
