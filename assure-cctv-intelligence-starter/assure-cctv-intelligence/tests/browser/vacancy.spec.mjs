import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installLiveWall } from '../live-wall.mjs';

const rows = page => page.locator('.fw-log-table tbody tr');
const dash = page => page.getByRole('link',{name:'Vacancy dashboard',exact:true}).click();

test('Heavy rescans all 16 positions on consecutive identical usable images; a blank tile stays unclear', async ({page}) => {
  await page.goto('/');
  const runs = await page.evaluate(async () => {
    const img = document.querySelector('img.fw-frame'); await img.decode();
    const c=document.createElement('canvas'); c.width=640;c.height=360;
    const ctx=c.getContext('2d'); for(let i=0;i<16;i++) if(i!==6) ctx.drawImage(img,(i%2)*800,(i%4>>1)*450,800,450,i%4*160,(i>>2)*90,160,90);
    const worker=new Worker('/occupancy/worker.js');
    try { const runs=[];for(let i=0;i<2;i++) { const frame=await createImageBitmap(c); const data=await new Promise((ok,err)=>{
      worker.onmessage=e=>ok(e.data); worker.onerror=e=>err(Error(e.message)); worker.postMessage({frame,cols:4,rows:4,live:true,mode:'heavy',frameToken:i},[frame]);
    }); runs.push(data); } return runs; } finally { worker.terminate(); }
  });
  for(const d of runs){expect(d.stats).toMatchObject({total:16,scanned:15,inferences:30,reused:0});expect(d.readings).toHaveLength(16);expect(d.readings[6]).toMatchObject({state:'unclear',reason:'poor-view'});expect(d.readings[15].state).toBe('empty');}
});

test('live Heavy sweeps feed named from/until periods while the dashboard is open; filter, export, reload and clear', async ({page}) => {
  test.setTimeout(100000);
  await page.goto('/'); await installLiveWall(page);
  await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button',{name:'Share screen'}).click();
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Empty','Empty']);
  await expect(page.locator('.fw-engine-stats')).toContainText('2/2 views freshly scanned');
  await dash(page); await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button',{name:'Name places'}).click();
  await page.getByLabel('Camera 01 · R1 C1').fill('Cabin A'); await page.getByLabel('Camera 02 · R1 C2').fill('Cabin B');
  await page.getByRole('button',{name:'Save names'}).click();
  const mine=rows(page).filter({hasText:'Cabin A'});
  // A browser can briefly stall delivery while a modal opens. It is correct to
  // split that period; measure the *latest* consecutive observations instead.
  await expect.poll(async()=>mine.filter({hasText:'Empty at last check'}).first().evaluate(tr=>{
    const [from,to]=tr.querySelectorAll('time'); return Date.parse(to.dateTime)-Date.parse(from.dateTime);
  })).toBeGreaterThan(0);
  await page.evaluate(()=>window.setWall(0,-1));
  const row=mine.filter({hasText:'Person detected'});
  await expect(row).toBeVisible(); await expect(rows(page).filter({hasText:'Cabin B'}).filter({hasText:'Unclear view'})).toBeVisible();
  const from=await row.locator('time').first().getAttribute('datetime'), until=await row.locator('time').last().getAttribute('datetime');
  expect(Date.parse(until)).toBeGreaterThan(Date.parse(from));
  await page.getByRole('button',{name:'Stop sharing'}).click(); expect(await page.evaluate(()=>window.wallTrack.readyState)).toBe('ended');
  await page.reload(); await expect(page.getByRole('heading',{name:'Vacancy dashboard'})).toBeVisible();
  await page.getByLabel('Find a place').fill('Cabin A'); await expect(rows(page).filter({hasText:'Cabin B'})).toHaveCount(0);
  await expect(row.locator('time').first()).toHaveAttribute('datetime',from); await expect(row.locator('time').last()).toHaveAttribute('datetime',until);
  await page.getByLabel('Observed on').fill('2000-01-01'); await expect(page.getByText('No matching empty periods')).toBeVisible();
  await page.getByLabel('Observed on').fill(''); await expect(row).toBeVisible();
  const promise=page.waitForEvent('download'); await page.getByRole('button',{name:'Export CSV'}).click(); const download=await promise;
  const csv=await readFile(await download.path(),'utf8'); expect(csv).toContain(from); expect(csv).toContain(until); expect(csv).toContain('Cabin A'); expect(csv).not.toContain('Cabin B');
  await page.getByRole('button',{name:'Clear history'}).click(); await page.getByRole('button',{name:'Delete saved history'}).click();
  await expect(page.getByText('No empty periods observed yet')).toBeVisible(); await page.goto('/reports'); await expect(page.getByRole('heading',{name:'Vacancy dashboard'})).toBeVisible();
});

test('a stalled capture closes at the last fresh inference; resume and crop cannot bridge it', async ({page}) => {
  await page.goto('/'); await installLiveWall(page); await page.getByRole('button',{name:'Fast',exact:true}).click();
  await page.getByLabel('Camera grid: columns by rows').selectOption('2x1'); await page.getByRole('button',{name:'Share screen'}).click();
  await expect(page.locator('.fw-camera-list .fw-status')).toHaveText(['Empty','Empty']);
  await page.evaluate(()=>window.freezeWall(true)); await expect(page.locator('.fw-no-frame')).toBeVisible();
  await dash(page); await expect(rows(page)).toHaveCount(2); await expect(rows(page).first()).toContainText('Gap in checks');
  const end=await rows(page).first().locator('time').last().getAttribute('datetime');
  await page.evaluate(()=>window.freezeWall(false)); await expect(rows(page)).toHaveCount(4);
  const start=await rows(page).first().locator('time').first().getAttribute('datetime'); expect(Date.parse(start)-Date.parse(end)).toBeGreaterThan(3000);
  await page.getByRole('link',{name:'View monitor'}).click(); await page.getByRole('button',{name:'Crop to camera grid'}).click();
  await page.getByText('Set margins by percentage').click(); await page.getByLabel('Right',{exact:true}).fill('2'); await page.getByRole('button',{name:'Apply crop'}).click();
  await dash(page); await expect(rows(page)).toHaveCount(6); await expect(page.getByRole('combobox',{name:'Camera layout',exact:true}).locator('option')).toHaveCount(3);
  await page.getByRole('button',{name:'Stop sharing'}).click(); await expect(page.locator('.fw-period-status.latest')).toHaveCount(0);
});
