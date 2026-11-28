import type { Rect } from './types';

// One integer source rectangle for the live viewport and the detector. Rounding
// independent edges on odd-sized captures must never reveal pixels outside it.
export function frameRegion(width: number, height: number, crop: Rect): Rect {
  const x = Math.max(0, Math.min(width - 1, Math.floor(crop.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(crop.y * height)));
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(crop.w * width))), h: Math.max(1, Math.min(height - y, Math.round(crop.h * height))) };
}

// The stage clips the full-size video. Percentages are relative to the cropped
// stage, not to the entire source. No per-frame canvas crop is needed to play it.
export function videoViewport(width: number, height: number, crop: Rect) {
  const { x, y, w, h } = frameRegion(width, height, crop);
  return { ratio: w / h, style: { left: `${-100*x/w}%`, top: `${-100*y/h}%`, width: `${100*width/w}%`, height: `${100*height/h}%` } };
}

export function fitFrame(w: number, h: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
