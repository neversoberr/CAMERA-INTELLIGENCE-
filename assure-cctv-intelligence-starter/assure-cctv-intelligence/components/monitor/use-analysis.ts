'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blankReadings, isSampleLayout, PROFILES, SAMPLE_READINGS, sourceElement, takeFrame,
  type DetectionMode, type Grid, type Reading, type Rect, type ScanStats, type Source,
} from '@/lib/monitor/types';
import { createAnalysisWorker } from '@/lib/monitor/platform';

type Phase = 'sample' | 'checking' | 'ready' | 'no-frame' | 'error';
type Snapshot = { readings: Reading[]; phase: Phase; ratio: number; checkedAt?: number; stats?: ScanStats };
const sample: Snapshot = { readings: SAMPLE_READINGS, phase: 'sample', ratio: 16 / 9 };

export function useAnalysis(source: Source, grid: Grid, crop: Rect, mode: DetectionMode) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep a loaded, idle model when changing a crop/grid/profile on this source.
  // Workspace is keyed by source; disconnect/unmount always releases the worker.
  const resident = useRef<Worker | null>(null);
  useEffect(() => () => { resident.current?.terminate(); resident.current = null; }, []);
  const [attempt, setAttempt] = useState(0);
  const key = useMemo(() => ({ source, grid, crop, mode, attempt }), [source, grid, crop, mode, attempt]);
  const n = grid.cols * grid.rows;
  const initial = useMemo<Snapshot>(() => ({ readings: blankReadings(n, 'checking'), phase: 'checking', ratio: 16 / 9 }), [n]);
  const [last, setLast] = useState<{ key: typeof key; view: Snapshot } | null>(null);
  const cachedSample = mode === 'balanced' && isSampleLayout(source, grid, crop);
  const view = cachedSample ? sample : last?.key === key ? last.view : initial;

  useEffect(() => {
    if (cachedSample) { resident.current?.terminate(); resident.current = null; return; }
    const profile = PROFILES[mode], live = source.kind === 'screen';
    let cancelled = false, busy = false, reset = true, timer: ReturnType<typeof setTimeout>, watchdog: ReturnType<typeof setTimeout>;
    let shown = false, checkedAt = 0, started = 0;
    const still = document.createElement('canvas');
    const show = () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      if (canvas.width !== still.width) canvas.width = still.width;
      if (canvas.height !== still.height) canvas.height = still.height;
      canvas.getContext('2d')?.drawImage(still, 0, 0); shown = true;
    };
    const update = (view: Snapshot) => { if (!cancelled) setLast({ key, view }); };
    const fail = () => {
      if (cancelled) return;
      clearTimeout(timer); clearTimeout(watchdog); resident.current?.terminate(); resident.current = null; busy = false;
      update({ readings: blankReadings(n, 'unclear'), phase: 'error', ratio: shown ? still.width / still.height : 16 / 9 });
    };
    const run = async () => {
      try {
        started = performance.now();
        const el = await sourceElement(source);
        if (cancelled) return;
        let frameToken: number | undefined;
        if (source.kind === 'screen') {
          const track = source.stream.getVideoTracks()[0], v = source.video;
          if (v.readyState < 2 || !track || track.readyState !== 'live' || track.muted || !track.enabled) {
            if (canvasRef.current) canvasRef.current.width = 1;
            shown = false; reset = true;
            update({ readings: blankReadings(n, 'unclear'), phase: 'no-frame', ratio: 16 / 9 });
            timer = setTimeout(run, 700); return;
          }
          frameToken = v.getVideoPlaybackQuality?.().totalVideoFrames || v.currentTime;
        }
        takeFrame(el, crop, still, profile.maxSide); checkedAt = Date.now();
        if (!shown) { show(); update({ ...initial, ratio: still.width / still.height }); }
        const worker = resident.current ??= createAnalysisWorker();
        worker.onerror = fail; worker.onmessageerror = fail;
        worker.onmessage = ({ data }: MessageEvent<{ error?: boolean; readings?: Reading[]; stats?: ScanStats }>) => {
          clearTimeout(watchdog); busy = false;
          if (cancelled) return;
          if (data.error || data.readings?.length !== n) { fail(); return; }
          show(); update({ readings: data.readings, phase: 'ready', ratio: still.width / still.height, checkedAt, stats: data.stats });
          // Target start-to-start cadence, never queue frames. Leave some idle
          // time even on a slow PC/large grid rather than spinning at 100% duty.
          const elapsed = performance.now() - started;
          if (live) timer = setTimeout(run, Math.max(90, Math.min(400, elapsed * 0.2), profile.interval - elapsed));
        };
        const frame = await createImageBitmap(still);
        if (cancelled) { frame.close(); return; }
        busy = true;
        worker.postMessage({ frame, ...grid, mode, live, frameToken, reset }, [frame]); reset = false;
        watchdog = setTimeout(fail, 60000);
      } catch { if (!cancelled) fail(); }
    };
    void run();
    return () => {
      cancelled = true; clearTimeout(timer); clearTimeout(watchdog);
      if (resident.current) {
        resident.current.onmessage = resident.current.onerror = resident.current.onmessageerror = null;
        // An in-flight response belongs to the old configuration; do not queue a
        // new scan behind it or let it repopulate a different camera wall.
        if (busy) { resident.current.terminate(); resident.current = null; }
      }
      still.width = 0; still.height = 0;
      if (canvasRef.current) canvasRef.current.width = 0;
    };
  }, [key, cachedSample, source, grid, crop, mode, n, initial]);
  return { ...view, canvasRef, retry: () => setAttempt(a => a + 1) };
}
