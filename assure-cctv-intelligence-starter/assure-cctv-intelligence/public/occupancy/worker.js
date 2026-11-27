// A classic worker allows MediaPipe to load its local WASM glue via importScripts.
// Screen frames never leave the browser. Keep at most one compact history per tile.
let engine, history = [], geometry = '';
async function initialise() {
  const packed = self.framewatchBundledAssets;
  const [{ FilesetResolver, ObjectDetector }, rules] = await Promise.all([
    import(packed?.vision ?? '/vision-runtime/vision_bundle.mjs'), import(packed?.rules ?? './analysis.mjs')
  ]);
  const files = packed?.files ?? await FilesetResolver.forVisionTasks('/vision-runtime/wasm');
  const load = modelAssetPath => ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath, delegate: 'CPU' },
    runningMode: 'IMAGE', categoryAllowlist: ['person'], scoreThreshold: rules.PERSON_FLOOR, maxResults: 20
  });
  const detector = await load(packed?.model ?? '/models/efficientdet-lite0.tflite');
  let heavy;
  const loadHeavy = () => heavy ??= load(packed?.heavyModel ?? '/models/efficientdet-lite2-int8.tflite');
  const tile = new OffscreenCanvas(1, 1), scout = new OffscreenCanvas(1, 1);
  const ctx = tile.getContext('2d', { alpha: false, willReadFrequently: true });
  const thumb = scout.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx || !thumb) throw new Error('No canvas context');
  return { detector, loadHeavy, tile, ctx, scout, thumb, rules };
}

function size(canvas, w, h) {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function detectRegion(e, frame, camera, region, pass, detector = e.detector) {
  const { x, y, w, h } = camera;
  const left = Math.round(region.x * w), top = Math.round(region.y * h);
  const cw = Math.round((region.x + region.w) * w) - left, ch = Math.round((region.y + region.h) * h) - top;
  const scale = Math.min(1, 640 / Math.max(cw, ch));
  size(e.tile, Math.max(1, Math.round(cw * scale)), Math.max(1, Math.round(ch * scale)));
  // Zoom directly into source pixels, not a previously downscaled model input.
  e.ctx.drawImage(frame, x+left, y+top, cw, ch, 0, 0, e.tile.width, e.tile.height);
  return e.rules.observations(detector.detect(e.tile).detections, e.tile.width, e.tile.height,
    { x: left/w, y: top/h, w: cw/w, h: ch/h }, pass);
}

self.onmessage = async ({ data: { frame, cols, rows, mode = 'balanced', live = false, frameToken, reset = false, reportProgress = false } }) => {
  try {
    engine ??= initialise();
    const e = await engine, r = e.rules, heavy = mode === 'heavy';
    const second = heavy ? await e.loadHeavy() : null;
    const now = performance.now();
    const key = `${cols}/${rows}/${frame.width}/${frame.height}/${mode}`;
    if (reset || !live || geometry !== key) history = [];
    geometry = key;
    const readings = [], stats = { inferences: 0, reused: 0, scanMs: 0, scanned: 0, total: cols * rows };
    size(e.scout, cols * r.THUMB_W, rows * r.THUMB_H);
    e.thumb.drawImage(frame, 0, 0, e.scout.width, e.scout.height);
    const pixels = e.thumb.getImageData(0, 0, e.scout.width, e.scout.height).data;
    for (let i = 0; i < cols * rows; i++) {
      if (heavy && reportProgress) self.postMessage({ progress: { camera: i + 1, total: stats.total } });
      const camera = r.tileBounds(i, cols, rows, frame.width, frame.height);
      const { usable, signature } = r.inspectTile(pixels, e.scout.width, i % cols * r.THUMB_W, Math.floor(i / cols) * r.THUMB_H);
      const last = history[i];
      if (camera.w < 40 || camera.h < 40 || !usable) {
        const reading = { state: 'unclear', reason: 'poor-view', boxes: [] };
        if (live) history[i] = r.settleLive(reading, last, frameToken); // invalidates cache and any pending negative vote
        readings.push(reading); continue;
      }
      if (live && !heavy && r.mayReuse(last, signature, now, i)) { readings.push({ ...last.reading, cached: true }); stats.reused++; continue; }

      const passes = [detectRegion(e, frame, camera, r.WHOLE, 0)]; stats.inferences++;
      stats.scanned++;
      if (second) { passes.push(detectRegion(e, frame, camera, r.WHOLE, 1, second)); stats.inferences++; }
      const exhaust = heavy || mode === 'detail';
      let reading = exhaust ? null : r.resolvePeople(passes);
      const windows = r.zoomWindows(mode, camera.w, camera.h);
      const negatives = live && mode === 'balanced' ? [...(last?.negatives ?? [])] : [];
      for (const [idx, window] of windows.entries()) {
        if (!exhaust && reading.state === 'occupied') break; // occupancy doesn't require counting every person
        if (live && mode === 'balanced' && !last?.guard && !passes[0].hits.length && r.mayReuseNegative(negatives[idx], signature, window, now)) continue;
        const pass = detectRegion(e, frame, camera, window, idx + (heavy ? 2 : 1), second ?? e.detector);
        passes.push(pass); stats.inferences++;
        if (live && mode === 'balanced') negatives[idx] = !pass.hits.length && !pass.unlocated ? { signature, at: now } : null;
        if (!exhaust) reading = r.resolvePeople(passes);
      }
      if (exhaust) reading = r.resolvePeople(passes);
      if (live) {
        const stable = r.settleLive(reading, last, frameToken);
        history[i] = { ...stable, signature, negatives, at: now }; reading = stable.reading;
      }
      readings.push(reading);
    }
    stats.scanMs = Math.round(performance.now() - now);
    self.postMessage({ readings, stats });
  } catch (error) {
    history = [];
    console.error('Local detector:', error); self.postMessage({ error: true });
  } finally { frame.close(); }
};
