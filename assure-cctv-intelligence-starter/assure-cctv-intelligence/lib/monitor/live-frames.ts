// Use *delivered video frames*, not currentTime (a clock that may advance while
// the pixels are frozen). This clock belongs to the capture, not the analysis
// profile. A new grid/mode cannot make an old frame look new.
const STALE_MS = 4000;
export function watchFrames(video: HTMLVideoElement, track: MediaStreamTrack) {
  let sequence = 0, epoch = 0, previous = -1, delivered = -Infinity, at = 0, callback = 0;
  const callbacks = typeof video.requestVideoFrameCallback === 'function';
  const invalidate = () => { if (delivered !== -Infinity) epoch++; delivered = -Infinity; };
  const note = (counter: number, presented: number) => {
    if (track.readyState !== 'live' || !track.enabled || track.muted) { invalidate(); return; }
    if (counter === previous || !Number.isFinite(counter)) return;
    if (presented - delivered > STALE_MS || counter < previous) epoch++;
    previous = counter; delivered = presented; sequence++;
    at = Math.round(Date.now() - Math.max(0, performance.now() - presented));
  };
  if (callbacks) {
    const onFrame: VideoFrameRequestCallback = (now, meta) => {
      note(meta.presentedFrames, meta.presentationTime ?? now);
      callback = video.requestVideoFrameCallback(onFrame);
    };
    callback = video.requestVideoFrameCallback(onFrame);
  }
  // The fallback counter must be sampled independently of a potentially slow
  // 16-camera sweep. Otherwise a long inference would look like a feed outage.
  const poll = () => {
    const q = video.getVideoPlaybackQuality?.();
    if (q && q.totalVideoFrames > q.droppedVideoFrames) note(q.totalVideoFrames - q.droppedVideoFrames, performance.now());
  };
  const timer = callbacks ? undefined : setInterval(poll, 300);
  track.addEventListener('mute', invalidate); track.addEventListener('unmute', invalidate);
  video.addEventListener('emptied', invalidate);
  return {
    read() {
      const now = performance.now();
      if (!callbacks) poll();
      if (track.readyState !== 'live' || !track.enabled || track.muted || video.readyState < 2 || now - delivered > STALE_MS) return null;
      return { token: sequence, epoch, at, frames: previous };
    },
    close() {
      if (callbacks) video.cancelVideoFrameCallback(callback);
      clearInterval(timer); track.removeEventListener('unmute', invalidate);
      track.removeEventListener('mute', invalidate); video.removeEventListener('emptied', invalidate);
    },
  };
}
export type FrameClock = ReturnType<typeof watchFrames>;
