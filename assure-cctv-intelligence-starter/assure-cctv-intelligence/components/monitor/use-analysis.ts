'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blankReadings, isSampleLayout, SAMPLE_READINGS, sourceElement, takeFrame,
  type Grid, type Reading, type Rect, type Source,
} from '@/lib/monitor/types';

import { createAnalysisWorker } from '@/lib/monitor/platform';

type Phase = 'sample' | 'checking' | 'ready' | 'no-frame' | 'error';
type Snapshot = { readings: Reading[]; phase: Phase; ratio: number; checkedAt?: number };
const sample: Snapshot = { readings: SAMPLE_READINGS, phase: 'sample', ratio: 16 / 9 };

export function useAnalysis(source: Source, grid: Grid, crop: Rect) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [attempt, setAttempt] = useState(0);
  const key = useMemo(() => ({ source, grid, crop, attempt }), [source, grid, crop, attempt]);
  const n = grid.cols * grid.rows;
  const initial = useMemo<Snapshot>(() => ({ readings: blankReadings(n, 'checking'), phase: 'checking', ratio: 16 / 9 }), [n]);
  const [last, setLast] = useState<{ key: typeof key; view: Snapshot } | null>(null);
  const cachedSample = isSampleLayout(source, grid, crop);
  // No stale labels, even for the single render before the previous effect is cleaned up.
  const view = cachedSample ? sample : last?.key === key ? last.view : initial;

  useEffect(() => {
    if (cachedSample) return;
    let cancelled = false, worker: Worker | undefined, timer: ReturnType<typeof setTimeout>, watchdog: ReturnType<typeof setTimeout>;
    let shown = false, checkedAt = 0;
    const still = document.createElement('canvas');
    const show = () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = still.width; canvas.height = still.height;
      canvas.getContext('2d')?.drawImage(still, 0, 0); shown = true;
    };
    const update = (view: Snapshot) => { if (!cancelled) setLast({ key, view }); };
    const fail = () => {
      clearTimeout(timer); clearTimeout(watchdog); worker?.terminate();
      update({ readings: blankReadings(n, 'unclear'), phase: 'error', ratio: shown ? still.width / still.height : 16 / 9 });
    };
    const run = async () => {
      try {
        const el = await sourceElement(source);
        if (cancelled) return;
        if (source.kind === 'screen') {
          const track = source.stream.getVideoTracks()[0];
          if (el instanceof HTMLVideoElement && (el.readyState < 2 || !track || track.readyState !== 'live' || track.muted || !track.enabled)) {
            if (canvasRef.current) canvasRef.current.width = 1;
            shown = false;
            update({ readings: blankReadings(n, 'unclear'), phase: 'no-frame', ratio: 16 / 9 });
            timer = setTimeout(run, 1500); return;
          }
        }
        takeFrame(el, crop, still);
        checkedAt = Date.now();
        if (!shown) { show(); update({ ...initial, ratio: still.width / still.height }); }
        if (!worker) {
          worker = createAnalysisWorker();
          worker.onerror = fail; worker.onmessageerror = fail;
          worker.onmessage = ({ data }: MessageEvent<{ error?: boolean; readings?: Reading[] }>) => {
            clearTimeout(watchdog);
            if (cancelled) return;
            if (data.error || data.readings?.length !== n) { fail(); return; }
            show();
            update({ readings: data.readings, phase: 'ready', ratio: still.width / still.height, checkedAt });
            // No overlapping inference; the next frame starts after the previous pass finishes.
            if (source.kind === 'screen') timer = setTimeout(run, 2200);
            else { worker?.terminate(); worker = undefined; }
          };
        }
        const frame = await createImageBitmap(still);
        if (cancelled) { frame.close(); return; }
        worker.postMessage({ frame, ...grid }, [frame]);
        watchdog = setTimeout(fail, 60000);
      } catch { if (!cancelled) fail(); }
    };
    void run();
    return () => {
      cancelled = true; clearTimeout(timer); clearTimeout(watchdog); worker?.terminate();
      still.width = 0; still.height = 0;
      if (canvasRef.current) canvasRef.current.width = 0;
    };
  }, [key, cachedSample, source, grid, crop, n, initial]);
  return { ...view, canvasRef, retry: () => setAttempt(a => a + 1) };
}
