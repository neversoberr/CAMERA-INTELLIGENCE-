'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { captureFrameRate, REALTIME_RATE } from '@/lib/monitor/capture-rate';
import { watchFrames } from '@/lib/monitor/live-frames';
import { DEMO, type Source } from '@/lib/monitor/types';

type Notice = { text: string; sharing?: boolean; info?: boolean } | null;
function release(source: Source) {
  if (source.kind !== 'screen') return;
  source.clock.close();
  source.stream.getTracks().forEach(track => track.stop());
  source.video.pause(); source.video.srcObject = null;
}

export function useSource(onRestoreSample: () => void) {
  const [{ source, revision }, setSource] = useState({ source: DEMO, revision: 0 });
  const [notice, setNotice] = useState<Notice>(null);
  const [picking, setPicking] = useState(false);
  const active = useRef<Source>(DEMO), ticket = useRef(0);
  const pendingScreen = useRef<Source | null>(null);
  const cancelPick = useCallback(() => {
    ++ticket.current;
    if (pendingScreen.current) release(pendingScreen.current);
    pendingScreen.current = null;
  }, []);
  const replace = useCallback((next: Source) => {
    const previous = active.current; active.current = next;
    release(previous); setSource(old => ({ source: next, revision: old.revision + 1 }));
  }, []);
  const clear = useCallback(() => {
    cancelPick(); setPicking(false); replace(DEMO); onRestoreSample();
    setNotice({ text: 'Source disconnected. The sample camera wall is now displayed.', info: true });
  }, [replace, cancelPick, onRestoreSample]);

  useEffect(() => {
    // pagehide also fires when the browser retains a page in its back/forward cache.
    const onLeave = () => { cancelPick(); setPicking(false); replace(DEMO); onRestoreSample(); };
    window.addEventListener('pagehide', onLeave);
    return () => { window.removeEventListener('pagehide', onLeave); cancelPick(); release(active.current); active.current = DEMO; };
  }, [replace, cancelPick, onRestoreSample]);

  async function share() {
    setNotice(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice({ text: 'Screen sharing is unavailable here. Use Framewatch on your PC in a current desktop Edge or Chrome browser, or choose Open image to check a screenshot.', sharing: true }); return;
    }
    cancelPick(); const id = ticket.current; setPicking(true);
    let candidate: Source | null = null;
    try {
      // The browser plays the shared window at its delivered rate. Detector
      // backpressure, not a low capture-rate cap, limits inference work.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: captureFrameRate(REALTIME_RATE) }, audio: false });
      const video = document.createElement('video'); video.muted = true; video.playsInline = true;
      const track = stream.getVideoTracks()[0];
      if (!track) { stream.getTracks().forEach(t => t.stop()); throw new Error('No video track'); }
      candidate = { kind: 'screen', video, stream, clock: watchFrames(video, track) };
      if (id !== ticket.current) return;
      pendingScreen.current = candidate; video.srcObject = stream;
      const next = candidate;
      track.addEventListener('ended', () => {
        if (active.current === next) clear();
        else if (pendingScreen.current === next) {
          cancelPick(); setPicking(false); setNotice({ text: 'Sharing ended before the first frame was available. Try sharing again.' });
        }
      }, { once: true });
      await video.play();
      if (id !== ticket.current) return;
      if (track.readyState !== 'live') throw new Error('Capture ended');
      pendingScreen.current = null; replace(candidate); candidate = null;
    } catch {
      if (id === ticket.current) setNotice({ text: 'No screen was shared. Choose the CCTV window when your browser asks. If sharing is blocked, choose Open image to check a screenshot.', sharing: true });
    } finally {
      if (pendingScreen.current === candidate) pendingScreen.current = null;
      if (candidate) release(candidate);
      if (id === ticket.current) setPicking(false);
    }
  }

  async function openImage(file: File) {
    setNotice(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) {
      setNotice({ text: 'Choose a PNG, JPG, or WebP screenshot under 25 MB.' }); return;
    }
    cancelPick(); const id = ticket.current; setPicking(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (id === ticket.current) replace({ kind: 'image', image, name: file.name });
    } catch {
      if (id === ticket.current) setNotice({ text: 'This image could not be read. Try another PNG, JPG, or WebP screenshot.' });
    } finally {
      URL.revokeObjectURL(url);
      if (id === ticket.current) setPicking(false);
    }
  }
  return { source, revision, notice, setNotice, picking, share, openImage, clear };
}
