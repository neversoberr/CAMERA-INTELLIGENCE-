// Serve the pinned MediaPipe JS and WASM from the app's origin, never a CDN.
import { cp, mkdir } from 'node:fs/promises';
const src = new URL('../node_modules/@mediapipe/tasks-vision/', import.meta.url);
const dest = new URL('../public/vision-runtime/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const path of ['vision_bundle.mjs', 'wasm']) {
  await cp(new URL(path, src), new URL(path, dest), { recursive: true });
}
