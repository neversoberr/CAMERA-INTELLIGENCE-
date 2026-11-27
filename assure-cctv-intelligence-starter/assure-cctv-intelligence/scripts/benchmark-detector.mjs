// Dev-only: measure the actual browser worker. Start the web app before running.
// Optionally point COCO_DIR at a COCO directory containing val2017/ + annotations/.
// No dataset, private feeds or benchmark telemetry are included in the application.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
const mode = process.env.SCAN_MODE || 'balanced';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  if (process.env.BENCH_WORKER_DIR) {
    // Compare trusted local worker revisions with the same runtime, browser and inputs.
    for (const name of ['worker.js', 'analysis.mjs']) await page.context().route(`**/occupancy/${name}`, async route => {
      await route.fulfill({ body: await readFile(join(process.env.BENCH_WORKER_DIR, name)), contentType: 'text/javascript' });
    });
  }
  await page.goto(process.env.FRAMEWATCH_URL || 'http://127.0.0.1:3000/');
  await page.evaluate(async mode => {
    const worker = new Worker('/occupancy/worker.js');
    window.scanTileWall = async (source, options) => {
      const frame = await createImageBitmap(source);
      const t = performance.now();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker timed out')), 60000);
        worker.onerror = e => { clearTimeout(timeout); reject(new Error(e.message)); };
        worker.onmessage = ({ data }) => {
          clearTimeout(timeout);
          if (!data.readings) return reject(new Error('Detector failed'));
          resolve({ ms: performance.now() - t, ...data });
        };
        worker.postMessage({ frame, mode, ...options }, [frame]);
      });
    };
    const image = new Image(); image.src = '/demo/camera-wall.webp'; await image.decode(); window.sampleImage = image;
  }, mode);
  const median = nums => nums.toSorted((a, b) => a - b)[Math.floor(nums.length / 2)];
  const gridRuns = Number(process.env.BENCH_GRID_RUNS || 12);
  const lab = await page.evaluate(async runs => {
    const wall = window.sampleImage, canvas = document.createElement('canvas');
    canvas.width = wall.width; canvas.height = wall.height;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const out = { static: [], changing: [] };
    for (const scene of ['static', 'changing']) {
      for (let i = 0; i <= runs; i++) {
        ctx.drawImage(wall, 0, 0);
        // Swap the two top views every other pass; two views stay fixed.
        if (scene === 'changing' && i % 2) {
          const w = wall.width / 2, h = wall.height / 2;
          ctx.drawImage(wall, w, 0, w, h, 0, 0, w, h); ctx.drawImage(wall, 0, 0, w, h, w, 0, w, h);
        }
        const { ms } = await window.scanTileWall(canvas, { cols: 2, rows: 2, live: true, frameToken: i, reset: i === 0 });
        if (i) out[scene].push(ms); // warm processing only, includes cache refreshes
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return out;
  }, gridRuns);
  for (const [scene, samples] of Object.entries(lab)) console.log(`${scene} 2×2: warm median ${median(samples).toFixed(1)} ms, mean ${(samples.reduce((a,b) => a+b, 0)/samples.length).toFixed(1)} ms (${samples.length} passes)`);
  const dir = process.env.COCO_DIR;
  if (dir) {
    const set = JSON.parse(await readFile(join(dir, 'annotations/instances_val2017.json'), 'utf8'));
    const person = set.categories.find(c => c.name === 'person').id;
    const positives = new Set(set.annotations.filter(a => a.category_id === person).map(a => a.image_id));
    const matrix = { person: { occupied: 0, empty: 0, unclear: 0 }, noPerson: { occupied: 0, empty: 0, unclear: 0 } };
    const times = [];
    for (const img of set.images) {
      const jpeg = await readFile(join(dir, 'val2017', basename(img.file_name)));
      const { readings, ms } = await page.evaluate(async data => {
        const image = new Image(); image.src = data; await image.decode();
        return window.scanTileWall(image, { cols: 1, rows: 1, live: false, reset: true });
      }, `data:image/jpeg;base64,${jpeg.toString('base64')}`);
      matrix[positives.has(img.id) ? 'person' : 'noPerson'][readings[0].state]++; times.push(ms);
    }
    console.log(JSON.stringify({ mode, images: times.length, medianStillMs: +median(times).toFixed(1), presenceMatrix: matrix }, null, 2));
  }
} finally { await browser.close(); }
