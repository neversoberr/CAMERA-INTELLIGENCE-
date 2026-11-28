import type { FrameClock } from './live-frames';
import { fitFrame, frameRegion } from './frame-region';
import { SAMPLE_URL } from '@/lib/monitor/platform';

export type Grid = { cols: number; rows: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type State = 'occupied' | 'empty' | 'unclear' | 'checking';
export type Reading = { state: State; boxes: Rect[]; cached?: boolean; reason?: 'person' | 'weak' | 'poor-view' | 'no-person' | 'confirming-empty'; score?: number };
export type DetectionMode = 'fast' | 'balanced' | 'detail' | 'heavy';
export type ScanStats = { scanMs: number; inferences: number; reused: number; scanned: number; total: number };
export const PROFILES = {
  fast: { label: 'Fast', note: 'One whole-view check. Use for close cameras or a slower PC.', interval: 400, maxSide: 1920 },
  balanced: { label: 'Balanced', note: 'Checks overlapping close-ups when a whole-view scan finds no clear person.', interval: 600, maxSide: 2560 },
  detail: { label: 'Detailed', note: 'Adds up to four overlapping close-ups per view. Best for distant people; scans take longer.', interval: 900, maxSide: 3840 },
  heavy: { label: 'Heavy', note: 'Two person models. Every usable camera gets a fresh scan, even when still. Higher CPU use.', interval: 1000, maxSide: 3840 },
} as const;
export type Source =
  | { kind: 'demo' }
  | { kind: 'image'; image: HTMLImageElement; name: string }
  | { kind: 'screen'; video: HTMLVideoElement; stream: MediaStream; clock: FrameClock };
export const DEMO: Source = { kind: 'demo' };
export const DEFAULT_GRID: Grid = { cols: 2, rows: 2 };
export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
export const SAMPLE_NAMES = ['Reception', 'Meeting room', 'Workspace', 'Corridor'];
// Cached output of the bundled detector for our illustrated 2×2 sample ONLY.
// User-selected media always goes through inference, even if it has the same dimensions.
export const SAMPLE_READINGS: Reading[] = [
  { state: 'occupied', reason: 'person', score: 0.37109375, boxes: [{ x: 284 / 640, y: 34 / 360, w: 76 / 640, h: 187 / 360 }] },
  { state: 'empty', boxes: [] },
  { state: 'occupied', reason: 'person', score: 0.43359375, boxes: [{ x: 408 / 640, y: 76 / 360, w: 56 / 640, h: 149 / 360 }] },
  { state: 'empty', boxes: [] },
];
// Same built-in still, measured with both models and four Lite2 close-ups per tile.
export const HEAVY_SAMPLE_READINGS: Reading[] = [
  { ...SAMPLE_READINGS[0], score: 0.4765625 }, SAMPLE_READINGS[1],
  { state: 'occupied', reason: 'person', score: 0.671875, boxes: [{ x: 0.63, y: 85/450, w: 77/800, h: 188/450 }] }, SAMPLE_READINGS[3],
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

// Freeze one frame per pass for inference and its evidence (never for playing
// the live video). Person boxes belong to these pixels, not to a later frame.
export function takeFrame(el: HTMLVideoElement | HTMLImageElement, crop: Rect, canvas: HTMLCanvasElement, maxSide = 2560) {
  const width = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const height = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!width || !height) throw new Error('No source frame');
  const { x, y, w, h } = frameRegion(width, height, crop);
  const { width: dw, height: dh } = fitFrame(w, h, maxSide);
  if (canvas.width !== dw) canvas.width = dw;
  if (canvas.height !== dh) canvas.height = dh;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(el, x, y, w, h, 0, 0, canvas.width, canvas.height);
}

// Request a bitmap directly from the native video. Do not synchronously copy
// the whole wall into a CPU canvas while the user is watching it play.
export function liveSnapshot(video: HTMLVideoElement, crop: Rect, maxSide: number) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('No source frame');
  const { x, y, w, h } = frameRegion(video.videoWidth, video.videoHeight, crop);
  const { width, height } = fitFrame(w, h, maxSide);
  return createImageBitmap(video, x, y, w, h, width === w && height === h ? {} : { resizeWidth: width, resizeHeight: height });
}
