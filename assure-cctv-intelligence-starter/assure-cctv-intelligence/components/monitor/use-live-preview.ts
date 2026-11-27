'use client';
import { useEffect, useRef, useState } from 'react';
import { videoViewport } from '@/lib/monitor/frame-region';
import type { Rect, Source } from '@/lib/monitor/types';

type Info = { width: number; height: number; receiving: boolean; fps: number | null };
export function useLivePreview(source: Source, crop: Rect) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<Info>(() => ({ width: source.kind === 'screen' ? source.video.videoWidth : 0,
    height: source.kind === 'screen' ? source.video.videoHeight : 0, receiving: false, fps: null }));
  useEffect(() => {
    const parent = host.current;
    if (source.kind !== 'screen' || !parent) return;
    const { video, stream, clock } = source, track = stream.getVideoTracks()[0];
    // Mount the ALREADY-playing element owned by useSource. One picker, track,
    // video sink and frame clock for the whole wall, including expanded view.
    video.setAttribute('aria-label', 'Live shared camera video'); parent.appendChild(video);
    let baseline: { frames: number; epoch: number; now: number } | null = null;
    const sample = () => {
      const stamp = clock.read(), now = performance.now();
      const fps = stamp && baseline && stamp.epoch === baseline.epoch && now - baseline.now >= 500
        ? Math.round(1000 * (stamp.frames - baseline.frames) / (now - baseline.now)) : null;
      baseline = stamp ? { frames: stamp.frames, epoch: stamp.epoch, now } : null;
      const width = video.videoWidth, height = video.videoHeight, receiving = !!stamp;
      setInfo(old => old.width === width && old.height === height && old.receiving === receiving && old.fps === fps
        ? old : { width, height, receiving, fps });
    };
    // Read an existing frame counter at 1 Hz for the UI; no React updates, draws,
    // model calls or history writes per playback frame. A stall is not progress.
    sample(); const timer = setInterval(sample, 1000);
    video.addEventListener('resize', sample); track?.addEventListener('mute', sample);
    return () => {
      clearInterval(timer); video.removeEventListener('resize', sample); track?.removeEventListener('mute', sample);
      if (video.parentNode === parent) parent.removeChild(video);
      // Only useSource stops or replaces the underlying capture.
    };
  }, [source]);
  const viewport = info.width && info.height ? videoViewport(info.width, info.height, crop) : null;
  return { host, viewport, receiving: info.receiving, fps: info.fps };
}
