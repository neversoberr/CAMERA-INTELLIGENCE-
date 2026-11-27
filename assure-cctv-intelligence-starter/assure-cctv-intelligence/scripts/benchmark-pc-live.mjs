// Measure the delivered UI's actual live update interval without a real screen
// or network. Only replace the OS picker with a synthetic four-camera stream.
import { chromium } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const archive = process.argv[2] || new URL('../public/downloads/Framewatch-PC.zip', import.meta.url);
const root = await mkdtemp(join(tmpdir(),'framewatch-bench-'));
let browser;
try {
  const file = join(root,'Framewatch.html');
  await writeFile(file, unzipSync(await readFile(archive), { filter: f => f.name === 'Framewatch.html' })['Framewatch.html']);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ offline: true }); await page.goto(pathToFileURL(file).href);
  await page.evaluate(async count => {
    const img = document.querySelector('img.fw-frame'); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { alpha: false }), w = c.width/2, h = c.height/2;
    let swap = false, previous, finish;
    const times = [];
    window.benchResults = new Promise((res, rej) => { finish = res; setTimeout(() => rej(new Error('No completed live scans')), 75000); });
    const paint = () => {
      ctx.drawImage(img,0,0);
      if (swap) { ctx.drawImage(img,w,0,w,h,0,0,w,h); ctx.drawImage(img,0,0,w,h,w,0,w,h); }
    };
    // Observe results without replacing inference or the app's scheduler. Change
    // the top two views after each result, keeping the bottom two stationary.
    window.Worker = class extends Worker {
      constructor(...args) { super(...args); this.addEventListener('message', ({data}) => {
        if (!data?.readings) return;
        const now = performance.now(); if (previous != null) times.push(now - previous);
        previous = now; swap = !swap; paint(); if (times.length === count + 1) finish(times.slice(1));
      }); }
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      paint(); const stream = c.captureStream(4); setInterval(paint, 250); requestAnimationFrame(paint); return stream;
    } });
  }, Number(process.env.BENCH_INTERVALS || 8));
  await page.getByRole('button',{name:'Share screen'}).click();
  const samples = await page.evaluate(() => window.benchResults);
  await page.getByRole('button',{name:'Stop sharing'}).click();
  const median = samples.toSorted((a,b)=>a-b)[Math.floor(samples.length / 2)];
  console.log(`PC 2×2 changing wall: median ${median.toFixed(0)} ms between completed updates (${samples.length} warm intervals)`);
} finally { await browser?.close(); await rm(root,{recursive:true,force:true}); }
