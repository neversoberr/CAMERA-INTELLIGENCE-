import { test, expect } from '@playwright/test';
test('hosted recorder tour is clearly a sample and never requests site credentials or a recorder API', async ({
  page,
}) => {
  const api = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) api.push(r.url());
  });
  await page.goto('/frigate');
  await expect(page.getByRole('heading', { name: 'Frigate recorder' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Windows app' })).toHaveAttribute(
    'href',
    '/downloads/Framewatch-PC.zip',
  );
  await page.getByRole('button', { name: 'Explore sample recorder' }).click();
  await expect(page.getByText('Illustrated data · not connected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch live' })).toHaveCount(0);
  const list = page.getByRole('region', { name: 'Recorder event timeline' });
  await list.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('workspace');
  await expect(list.locator('li')).toHaveCount(1);
  await list.getByRole('button', { name: /Review person event/ }).click();
  await expect(page.getByRole('dialog')).toContainText('SAMPLE EVENT');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Exit sample' }).click();
  await expect(page.getByRole('button', { name: 'Explore sample recorder' })).toBeVisible();
  expect(api).toEqual([]);
});
