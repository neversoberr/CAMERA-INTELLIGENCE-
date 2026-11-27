import { SAMPLE_URL } from '@/lib/monitor/platform';

export type Grid = { cols: number; rows: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type State = 'occupied' | 'empty' | 'unclear' | 'checking';
export type Reading = { state: State; boxes: Rect[] };
export type Source =
  | { kind: 'demo' }
  | { kind: 'image'; image: HTMLImageElement; name: string }
  | { kind: 'screen'; video: HTMLVideoElement; stream: MediaStream };
export const DEMO: Source = { kind: 'demo' };
export const DEFAULT_GRID: Grid = { cols: 2, rows: 2 };
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const SAMPLE_NAMES = ['Reception', 'Meeting room', 'Workspace', 'Corridor'];
// Cached output of the bundled detector for our illustrated 2×2 sample ONLY.
// User-selected media always goes through inference, even if it has the same dimensions.
export const SAMPLE_READINGS: Reading[] = [
  { state: 'occupied', boxes: [{ x: 284 / 640, y: 34 / 360, w: 76 / 640, h: 187 / 360 }] },
  { state: 'empty', boxes: [] },
  { state: 'occupied', boxes: [{ x: 408 / 640, y: 76 / 360, w: 56 / 640, h: 149 / 360 }] },
  { state: 'empty', boxes: [] },
];
export const stateLabel: Record<State, string> = { occupied: 'Occupied', empty: 'Empty', unclear: 'Unclear', checking: 'Checking' };
export const twoDigits = (n: number) => String(n).padStart(2, '0');
export const isFull = (r: Rect) => r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1;
export const isSampleLayout = (s: Source, g: Grid, r: Rect) => s.kind === 'demo' && g.cols === 2 && g.rows === 2 && isFull(r);
export const blankReadings = (n: number, state: State): Reading[] => Array.from({ length: n }, () => ({ state, boxes: [] }));
export const sourceName = (s: Source) => s.kind === 'demo' ? 'Sample camera wall' : s.kind === 'image' ? s.name : 'Shared screen';

export async function sourceElement(source: Source) {
  if (source.kind === 'screen') return source.video;
  if (source.kind === 'image') return source.image;
  const img = new Image(); img.src = SAMPLE_URL; await img.decode(); return img;
}

// Freeze one frame per pass. The detector and the visible overlay must refer to
// the very same pixels, not to a video which has already moved on.
export function takeFrame(el: HTMLVideoElement | HTMLImageElement, crop: Rect, canvas: HTMLCanvasElement, maxSide = 2560) {
  const width = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const height = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!width || !height) throw new Error('No source frame');
  const x = Math.floor(crop.x * width), y = Math.floor(crop.y * height);
  const w = Math.max(1, Math.round(crop.w * width)), h = Math.max(1, Math.round(crop.h * height));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(el, x, y, w, h, 0, 0, canvas.width, canvas.height);
}
