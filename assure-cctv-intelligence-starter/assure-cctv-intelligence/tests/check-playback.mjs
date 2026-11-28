import { expect } from '@playwright/test';
import { installMovingWall, measureMotion } from './moving-wall.mjs';

// Run the same check in the hosted UI and the actual extracted offline HTML.
export async function checkPlayback(page) {
  await installMovingWall(page);
  await page.evaluate(() => {
    const p = window.previewProbe; p.checkEvidence = true; p.mainCopies = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      if (image instanceof HTMLVideoElement && this.canvas.width >= 640 && this.canvas.height >= 360) p.mainCopies++;
      return draw.call(this, image, ...args);
    };
  });
  const live = page.getByRole('button', { name: 'Live video', exact: true });
  const scan = page.getByRole('button', { name: 'Last scan', exact: true });
  const video = page.locator('.fw-stage video'), still = page.locator('.fw-stage canvas');
  await page.getByRole('button', {name:'Share screen'}).click();
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(video).toBeVisible(); await expect(still).toBeHidden();
  await expect(page.locator('.fw-frame-note')).toContainText('Heavy sweep');
  const result = await measureMotion(page, 2000);
  expect(result.changes, 'different pixel markers on the displayed media').toBeGreaterThan(10);
  expect(result.duringSweep, 'changes between submission and result of the SAME Heavy scan').toBeGreaterThan(2);
  expect(result.maxPending).toBe(1);
  const {video: constraints, audio} = await page.evaluate(() => window.previewProbe.constraints);
  expect(audio).toBe(false); expect(constraints.frameRate).toEqual({ideal:60});
  await expect(page.locator('.fw-engine-stats')).toContainText('4/4 views freshly scanned');
  await expect(page.locator('.fw-playback-meter')).toHaveText(/Input ~[1-9]\d* fps/);
  await expect(page.locator('.fw-tile-caption').first()).toContainText('Last check:');
  await expect(page.locator('.fw-person-box')).toHaveCount(0);
  await scan.click(); await expect(video).toBeHidden(); await expect(still).toBeVisible();
  await expect(page.locator('.fw-person-box').first()).toBeVisible();
  const e = await page.evaluate(() => {const p=window.previewProbe; return {submitted:p.lastCheckedId, visible:p.displayedId(), copies:p.mainCopies};});
  expect(typeof e.submitted).toBe('number'); expect(e.visible).toBe(e.submitted); expect(e.copies).toBe(0);
  await live.click(); await expect(video).toBeVisible(); await expect(still).toBeHidden();
  expect(await video.evaluate(v => v.srcObject.getVideoTracks()[0] === window.previewProbe.track && !v.paused)).toBe(true);
  expect(await page.evaluate(() => window.previewProbe.picks)).toBe(1);
}
