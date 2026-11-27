'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blankReadings, HEAVY_SAMPLE_READINGS, isSampleLayout, PROFILES, SAMPLE_READINGS, sourceElement, takeFrame,
  type DetectionMode, type Grid, type Reading, type Rect, type ScanStats, type Source,
} from '@/lib/monitor/types';
import { createAnalysisWorker } from '@/lib/monitor/platform';
import type { VacancyJournal } from '@/lib/monitor/vacancy';

type Phase = 'sample' | 'checking' | 'ready' | 'no-frame' | 'error';
type Snapshot = { readings: Reading[]; phase: Phase; ratio: number; checkedAt?: number; stats?: ScanStats };
type Progress = { camera: number; total: number };
const sample: Snapshot = { readings: SAMPLE_READINGS, phase: 'sample', ratio: 16 / 9 };
const heavySample: Snapshot = { ...sample, readings: HEAVY_SAMPLE_READINGS };

export function useAnalysis(source: Source, grid: Grid, crop: Rect, mode: DetectionMode, journal: VacancyJournal) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resident = useRef<Worker | null>(null), session = useRef<string | null>(null);
  useEffect(() => () => { resident.current?.terminate(); resident.current = null; }, []);
  // Names belong to this source/grid/crop, not to an arbitrary future Camera 01.
  useEffect(() => {
    if (source.kind !== 'screen') return;
    session.current = journal.start(grid.cols, grid.rows);
    return () => { if (session.current) journal.finish(session.current); session.current = null; };
  }, [journal, source, grid, crop]);
  const [attempt, setAttempt] = useState(0);
  const key = useMemo(() => ({ source, grid, crop, mode, attempt }), [source, grid, crop, mode, attempt]);
  const n = grid.cols * grid.rows;
  const initial = useMemo<Snapshot>(() => ({ readings: blankReadings(n, 'checking'), phase: 'checking', ratio: 16 / 9 }), [n]);
  const [last, setLast] = useState<{ key: typeof key; view: Snapshot } | null>(null);
  const [progress, setProgress] = useState<{ key: typeof key; value: Progress } | null>(null);
  const cachedSample = (mode === 'balanced' || mode === 'heavy') && isSampleLayout(source, grid, crop);
  const view = cachedSample ? mode === 'heavy' ? heavySample : sample : last?.key === key ? last.view : initial;

  useEffect(() => {
    if (cachedSample) { resident.current?.terminate(); resident.current = null; return; }
    const profile = PROFILES[mode], live = source.kind === 'screen';
    let id = session.current;
    let cancelled = false, busy = false, reset = true, timer: ReturnType<typeof setTimeout>, watchdog: ReturnType<typeof setTimeout>;
    let shown = false, missing = false, checkedAt = 0, started = 0, token = -1, epoch = -1, dimensions = '';
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
      if (id) journal.interrupt(id); setProgress(null);
      update({ readings: blankReadings(n, 'unclear'), phase: 'error', ratio: shown ? still.width / still.height : 16 / 9 });
    };
    const noFrame = () => {
      if (!missing) {
        if (id) journal.interrupt(id);
        if (canvasRef.current) canvasRef.current.width = 1;
        update({ readings: blankReadings(n, 'unclear'), phase: 'no-frame', ratio: 16 / 9 });
      }
      setProgress(null); shown = false; reset = true; missing = true;
      timer = setTimeout(run, 350);
    };
    const run = async () => {
      try {
        started = performance.now();
        const el = await sourceElement(source);
        if (cancelled) return;
        if (source.kind === 'screen') {
          const stamp = source.clock.read();
          if (!stamp) { noFrame(); return; }
          if (stamp.token === token) { timer = setTimeout(run, 200); return; }
          const size = `${source.video.videoWidth}x${source.video.videoHeight}`;
          if (dimensions && size !== dimensions && id) {
            journal.finish(id); id = session.current = journal.start(grid.cols, grid.rows); reset = true;
          }
          if (epoch !== stamp.epoch && id) { journal.interrupt(id); reset = true; }
          token = stamp.token; epoch = stamp.epoch; checkedAt = stamp.at; dimensions = size; missing = false;
        } else checkedAt = Date.now();
        takeFrame(el, crop, still, profile.maxSide);
        if (!shown) { show(); update({ ...initial, ratio: still.width / still.height }); }
        const worker = resident.current ??= createAnalysisWorker();
        worker.onerror = fail; worker.onmessageerror = fail;
        worker.onmessage = ({ data }: MessageEvent<{ error?: boolean; progress?: Progress; readings?: Reading[]; stats?: ScanStats }>) => {
          clearTimeout(watchdog);
          if (cancelled) return;
          if (data.progress) { setProgress({ key, value: data.progress }); watchdog = setTimeout(fail, 60000); return; }
          busy = false; setProgress(null);
          if (data.error || data.readings?.length !== n) { fail(); return; }
          // An old sweep must not reopen a period after capture stalled/disconnected.
          if (source.kind === 'screen' && source.clock.read()?.epoch !== epoch) { noFrame(); return; }
          show(); update({ readings: data.readings, phase: 'ready', ratio: still.width / still.height, checkedAt, stats: data.stats });
          if (id) journal.observe(id, checkedAt, token, data.readings);
          const elapsed = performance.now() - started;
          if (live) timer = setTimeout(run, Math.max(90, Math.min(400, elapsed * 0.2), profile.interval - elapsed));
        };
        const frame = await createImageBitmap(still);
        if (cancelled) { frame.close(); return; }
        busy = true;
        worker.postMessage({ frame, ...grid, mode, live, frameToken: token, reset, reportProgress: mode === 'heavy' }, [frame]); reset = false;
        watchdog = setTimeout(fail, 60000);
      } catch { if (!cancelled) fail(); }
    };
    void run();
    return () => {
      cancelled = true; clearTimeout(timer); clearTimeout(watchdog);
      if (id) journal.interrupt(id); // changing mode / retrying breaks continuity, not the camera names
      if (resident.current) {
        resident.current.onmessage = resident.current.onerror = resident.current.onmessageerror = null;
        if (busy) { resident.current.terminate(); resident.current = null; }
      }
      still.width = 0; still.height = 0;
      if (canvasRef.current) canvasRef.current.width = 0;
    };
  }, [key, cachedSample, source, grid, crop, mode, n, initial, journal]);
  return { ...view, progress: progress?.key === key ? progress.value : null, canvasRef, retry: () => setAttempt(a => a + 1) };
}
