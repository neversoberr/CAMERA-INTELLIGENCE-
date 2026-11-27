// Build the same monitor as a self-contained local HTML page. No executable,
// installer, privileged port, server, or file-access browser flags are needed.
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path));
const dataURL = async (path, mime) => `data:${mime};base64,${(await read(path)).toString('base64')}`;
const scriptText = source => source.replace(/<\/script/gi, '<\\/script');
const runtime = 'node_modules/@mediapipe/tasks-vision';

const { outputFiles } = await build({
  absWorkingDir: root, entryPoints: ['portable/main.tsx'], outdir: '.cache/pc', write: false,
  platform: 'browser', format: 'iife', bundle: true, minify: true, legalComments: 'inline',
  jsx: 'automatic', target: 'es2021', define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@/lib/monitor/platform': './portable/platform.ts' }, loader: { '.woff2': 'dataurl' },
});
const js = outputFiles.find(f => f.path.endsWith('.js')).text;
const css = outputFiles.find(f => f.path.endsWith('.css')).text;

// Current Edge/Chrome support SIMD. Ship one WASM variant, not two copies.
const assets = {
  vision: await dataURL(`${runtime}/vision_bundle.mjs`, 'text/javascript'),
  rules: await dataURL('public/occupancy/analysis.mjs', 'text/javascript'),
  files: {
    wasmLoaderPath: await dataURL(`${runtime}/wasm/vision_wasm_internal.js`, 'text/javascript'),
    wasmBinaryPath: await dataURL(`${runtime}/wasm/vision_wasm_internal.wasm`, 'application/wasm'),
  },
  model: await dataURL('public/models/efficientdet-lite0.tflite', 'application/octet-stream'),
  heavyModel: await dataURL('public/models/efficientdet-lite2-int8.tflite', 'application/octet-stream'),
};
const worker = `self.framewatchBundledAssets=${JSON.stringify(assets)};\n${await read('public/occupancy/worker.js')}`;
// In particular, neither the page nor its blob worker may fetch from the network.
const csp = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; worker-src blob:; connect-src data: blob:; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src blob: mediastream:; base-uri 'none'; form-action 'none'";
const sample = await read('public/demo/camera-wall.webp');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Framewatch · PC occupancy monitor</title>
<link rel="icon" href="${await dataURL('app/icon.svg', 'image/svg+xml')}"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head>
<body><div id="root">Opening Framewatch…</div><noscript>Open the extracted Framewatch.html in a desktop browser that can run JavaScript.</noscript>
<script type="text/plain" id="fw-sample">data:image/webp;base64,${sample.toString('base64')}</script>
<script type="text/plain" id="fw-worker">${scriptText(worker)}</script><script>${scriptText(js)}</script></body></html>\n`;

// Explicit allowlist: never include .env files, user media, or build caches.
const files = {
  'Framewatch.html': strToU8(html),
  'START HERE.txt': strToU8((await read('portable/START HERE.txt')).toString().replace(/\r?\n/g, '\r\n')),
  'Example camera grid.webp': sample,
  'Licenses/model/LICENSE.txt': await read('public/models/LICENSE.txt'),
  'Licenses/model/NOTICE.md': await read('public/models/NOTICE.md'),
  'Licenses/MediaPipe.txt': strToU8('MediaPipe Tasks Vision, Copyright The MediaPipe Authors. Licensed under Apache-2.0; see model/LICENSE.txt.\n'),
};
for (const dep of ['react', 'react-dom', 'scheduler', 'lucide-react', '@fontsource-variable/manrope']) {
  files[`Licenses/${dep.split('/').at(-1)}.txt`] = await read(`node_modules/${dep}/LICENSE`);
}
const outputDir = resolve(root, 'public/downloads');
await mkdir(outputDir, { recursive: true });
const zip = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
const path = resolve(outputDir, 'Framewatch-PC.zip');
await writeFile(`${path}.tmp`, zip);
await rename(`${path}.tmp`, path);
console.log(`Created ${path} (${(zip.length / 1024 / 1024).toFixed(1)} MiB). Extract and open Framewatch.html.`);
