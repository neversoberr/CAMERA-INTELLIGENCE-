// A classic worker allows MediaPipe to load its local WASM glue via importScripts.
// No frame sent here ever leaves the browser. Only small result objects go back.
let engine;
async function initialise() {
  // Only the self-contained PC build supplies embedded data URLs. The web
  // worker uses the original same-origin paths. Neither accepts paths in messages.
  const packed = self.framewatchBundledAssets;
  const [{ FilesetResolver, ObjectDetector }, rules] = await Promise.all([
    import(packed?.vision ?? '/vision-runtime/vision_bundle.mjs'), import(packed?.rules ?? './analysis.mjs')
  ]);
  const files = packed?.files ?? await FilesetResolver.forVisionTasks('/vision-runtime/wasm');
  const detector = await ObjectDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: packed?.model ?? '/models/efficientdet-lite0.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE', categoryAllowlist: ['person'], scoreThreshold: 0.25, maxResults: 20
  });
  const tile = new OffscreenCanvas(1, 1);
  const ctx = tile.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas context');
  return { detector, tile, ctx, ...rules };
}

self.onmessage = async ({ data: { frame, cols, rows } }) => {
  try {
    engine ??= initialise();
    const { detector, tile, ctx, tileBounds, usableView, classify } = await engine;
    const readings = [];
    for (let i = 0; i < cols * rows; i++) {
      const { x, y, w, h } = tileBounds(i, cols, rows, frame.width, frame.height);
      if (w < 40 || h < 40) { readings.push({ state: 'unclear', boxes: [] }); continue; }
      const scale = Math.min(1, 640 / Math.max(w, h));
      tile.width = Math.max(1, Math.round(w * scale));
      tile.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(frame, x, y, w, h, 0, 0, tile.width, tile.height);
      const pixels = ctx.getImageData(0, 0, tile.width, tile.height);
      if (!usableView(pixels.data, tile.width, tile.height)) {
        readings.push({ state: 'unclear', boxes: [] });
      } else {
        readings.push(classify(detector.detect(tile).detections, tile.width, tile.height));
      }
    }
    self.postMessage({ readings });
  } catch (error) {
    console.error('Local detector:', error);
    self.postMessage({ error: true });
  } finally {
    frame.close();
  }
};
