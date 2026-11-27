// Measure changing pixels reaching the displayed wall, NOT detector throughput.
// Run against an actual extracted PC zip, offline, with a deterministic marker.
import { chromium } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installMovingWall, measureMotion } from '../tests/moving-wall.mjs';
const zip = process.argv[2] || new URL('../public/downloads/Framewatch-PC.zip', import.meta.url);
const dir = await mkdtemp(join(tmpdir(),'Framewatch playback '));
let browser;
try {
  const html = join(dir,'Framewatch.html');
  await writeFile(html, unzipSync(await readFile(zip), { filter: f => f.name === 'Framewatch.html' })['Framewatch.html']);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ offline:true }); await page.goto(pathToFileURL(html).href);
  await installMovingWall(page, 30); await page.getByRole('button', {name:'Share screen'}).click();
  await page.locator('.fw-engine-stats').filter({hasText:'24 model passes'}).waitFor(); // exclude model load
  const r = await measureMotion(page, 12_000);
  const hz = n => +(1000*n/r.ms).toFixed(2);
  console.log(JSON.stringify({ mode:'Heavy', requestedFrameRate: await page.evaluate(()=>window.previewProbe.constraints.video.frameRate),
    ...r, sourceChangesPerSec:hz(r.produced), visibleChangesPerSec:hz(r.changes) }, null, 2));
  await page.getByRole('button', {name:'Stop sharing'}).click();
} finally { await browser?.close(); await rm(dir, {recursive:true, force:true}); }
