import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installLiveWall } from '../live-wall.mjs';

const reminders = page => page.getByRole('link', { name: 'Reminders', exact: true }).click();
const toggle = page => page.getByRole('switch', { name: 'Empty-cabin reminders' });
const alert = page => page.getByLabel('Vacancy reminder', { exact: true });
const counts = page => page.evaluate(() => window.calls.filter(n => !n.title.includes('Test notification')).length);
const wall = fileURLToPath(new URL('../../public/demo/camera-wall.webp', import.meta.url));

test('named single-cabin rule calls the granted browser notification API once per period and re-arms on a new vacancy', async ({ page, context }) => {
  // Headless Chromium has no desktop permission prompt/banner. Simulate the
  // user's permission choice but call the real browser constructor with the payload.
  await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:3000' });
  await page.addInitScript(() => {
    window.calls = []; window.prompts = 0; const Native = window.Notification;
    window.Notification = class {
      static permission = 'default';
      static async requestPermission() { window.prompts++; return this.permission = 'granted'; }
      constructor(...args) {
        const n = new Native(...args); window.calls.push({ title: n.title, body: n.body }); window.lastNative = n; return n;
      }
    };
  });
  await page.goto('/'); await installLiveWall(page); await page.evaluate(() => window.setWall(0,-1));
  await page.getByRole('button',{name:'Fast',exact:true}).click(); await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button',{name:'Share screen'}).click(); await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied','Unclear']);
  await page.getByRole('link',{name:'Vacancy dashboard',exact:true}).click(); await page.getByRole('button',{name:'Name places'}).click();
  await page.getByLabel('Camera 01 · R1 C1').fill('East cabin'); await page.getByRole('button',{name:'Save names'}).click();
  await reminders(page); await expect(toggle(page)).not.toBeChecked(); await page.getByLabel('Camera or place').selectOption('0');
  await toggle(page).click(); expect(await page.evaluate(()=>window.prompts)).toBe(0);
  await page.getByRole('button',{name:'Enable desktop notifications'}).click(); expect(await page.evaluate(()=>window.prompts)).toBe(1);
  await page.getByRole('button',{name:'Test notification'}).click(); expect(await counts(page)).toBe(0);
  await page.evaluate(() => window.setWall(1,3)); await expect(alert(page)).toContainText('East cabin observed empty');
  expect(await page.evaluate(() => window.calls.map(n=>n.title))).toEqual(['Framewatch · Test notification','Framewatch · East cabin observed empty']);
  await page.evaluate(() => window.lastNative.onclick()); await expect(page.getByRole('heading',{name:'Vacancy dashboard'})).toBeVisible();
  await page.getByRole('button',{name:'Dismiss reminder'}).click();
  // Wait for another *fresh* check while empty (not just a reused UI result).
  const entry=page.locator('.fw-log-table tr').filter({hasText:'East cabin'}); const last=entry.locator('time').last();
  const t=await last.getAttribute('datetime'); await expect(last).not.toHaveAttribute('datetime',t); await expect(alert(page)).toHaveCount(0); expect(await counts(page)).toBe(1);
  await page.evaluate(() => window.setWall(0,3)); await expect(entry).toContainText('Person detected');
  await page.evaluate(() => window.setWall(1,3)); await expect(alert(page)).toContainText('East cabin observed empty'); expect(await counts(page)).toBe(2);
  await page.getByRole('button',{name:'Stop sharing'}).click(); await expect(alert(page)).toHaveCount(0);
  await reminders(page); await page.getByRole('button',{name:'Share screen'}).click(); await expect(page.locator('.fw-rule-status')).toContainText('Choose a place in this layout');
  await page.getByRole('link',{name:'View monitor'}).click(); await expect(page.locator('.fw-results-foot')).toContainText('Checked'); expect(await counts(page)).toBe(2);
});

test('permission denial does not stop in-app alerts; samples, screenshots and restored history never notify', async ({ page }) => {
  await page.addInitScript(() => {
    window.prompts=0; window.calls=[];
    window.Notification=class {
      static permission='default';
      static async requestPermission() { window.prompts++; return this.permission='denied'; }
      constructor(title) { window.calls.push({title}); }
    };
  });
  await page.goto('/alerts'); await expect(page.getByRole('heading',{name:'Empty-cabin reminders'})).toBeVisible();
  await installLiveWall(page); await toggle(page).click(); expect(await page.evaluate(()=>window.prompts)).toBe(0);
  await page.getByRole('button',{name:'Enable desktop notifications'}).click(); await expect(page.getByText('Blocked by browser')).toBeVisible();
  expect(await page.evaluate(()=>window.prompts)).toBe(1); await expect(alert(page)).toHaveCount(0);
  await page.getByRole('combobox',{name:'Remind me',exact:true}).selectOption('300000');
  await page.getByRole('link',{name:'View monitor'}).click(); await page.getByRole('button',{name:'Fast',exact:true}).click();
  await page.getByLabel('Open camera screenshot').setInputFiles(wall); await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Occupied','Empty','Occupied','Empty']);
  await expect(alert(page)).toHaveCount(0); await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button',{name:'Share screen'}).click(); await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Empty','Empty']);
  await expect(alert(page)).toHaveCount(0); await reminders(page); await page.getByRole('combobox',{name:'Remind me',exact:true}).selectOption('0');
  await expect(alert(page)).toContainText('observed empty'); // whichever camera next receives a fresh (not cached) inference
  expect(await counts(page)).toBe(0); await page.getByRole('button',{name:'Stop sharing'}).click(); await expect(alert(page)).toHaveCount(0);
  await page.goto('/alerts'); await expect(toggle(page)).toBeChecked(); await expect(alert(page)).toHaveCount(0);
  expect(await page.evaluate(()=>window.prompts)).toBe(0); await toggle(page).click(); await page.reload(); await expect(toggle(page)).not.toBeChecked();
});
