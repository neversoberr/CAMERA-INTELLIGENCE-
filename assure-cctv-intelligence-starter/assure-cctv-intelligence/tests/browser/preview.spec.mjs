import { expect, test } from '@playwright/test';
import { checkPlayback } from '../check-playback.mjs';
import { installMovingWall, measureMotion } from '../moving-wall.mjs';

test('live pixels advance during Heavy sweeps; cropping and expansion align without a second capture', async ({page}) => {
  await page.goto('/'); await checkPlayback(page);
  await page.getByRole('button', {name:'Crop to camera grid'}).click();
  await page.getByText('Set margins by percentage').click();
  await page.getByLabel('Left', {exact:true}).fill('25');
  await page.getByLabel('Bottom', {exact:true}).fill('10');
  await page.getByRole('button', {name:'Apply crop'}).click();
  // Source 640×360; remove 160 left + 36 bottom. The native video and the
  // grid must coincide with these pixels, irrespective of the viewport size.
  const checkCrop = async () => {
    const geometry = await page.locator('.fw-stage').evaluate(stage => {
      const s = stage.getBoundingClientRect(), v = stage.querySelector('video').getBoundingClientRect();
      const cells = [...stage.querySelectorAll('.fw-tile')].map(t => t.getBoundingClientRect());
      return {x:(s.x-v.x)/v.width, y:(s.y-v.y)/v.height, w:s.width/v.width, h:s.height/v.height, ratio:s.width/s.height,
        gridWidth:(cells[1].right-cells[0].left)/s.width, gridHeight:(cells[2].bottom-cells[0].top)/s.height};
    });
    for (const [k, expected] of Object.entries({x:.25,y:0,w:.75,h:.90,ratio:480/324,gridWidth:1,gridHeight:1})) expect(geometry[k]).toBeCloseTo(expected, 2);
  };
  await checkCrop(); await page.setViewportSize({width:700, height:380});
  await page.getByRole('button', {name:'Expand camera wall'}).click(); await checkCrop();
  expect(await page.locator('.fw-stage').evaluate(el => el.offsetHeight <= el.parentElement.clientHeight + 1)).toBe(true);
  await page.keyboard.press('Escape'); await page.getByRole('button', {name:'Stop sharing'}).click();
  await expect(page.locator('.fw-stage video')).toHaveCount(0);
  expect(await page.evaluate(() => window.previewProbe.track.readyState)).toBe('ended');
});

test('a failed detector does not freeze or replace the live picture', async ({context,page}) => {
  await context.route('**/models/efficientdet-lite2-int8.tflite', route => route.fulfill({ status:503, body:'unavailable' }));
  await page.goto('/'); await installMovingWall(page);
  await page.getByRole('button', {name:'Share screen'}).click();
  await expect(page.getByRole('button', {name:'Retry analysis'})).toBeVisible();
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(Array(4).fill('Unclear'));
  expect((await measureMotion(page, 1200)).changes).toBeGreaterThan(5);
  await page.getByRole('button', {name:'Last scan',exact:true}).click();
  await expect(page.getByText('No checked frame available')).toBeVisible();
  await expect(page.locator('.fw-stage canvas')).toBeHidden();
  await page.getByRole('button', {name:'Stop sharing'}).click();
});
