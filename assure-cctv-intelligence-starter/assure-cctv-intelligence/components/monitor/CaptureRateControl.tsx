'use client';
import { useState } from 'react';
import { captureFrameRate, REALTIME_RATE, type CaptureRate } from '@/lib/monitor/capture-rate';

// One instance per share. Changing this preference must not restart inference,
// invalidate cabin names, or prompt for a second capture.
export function CaptureRateControl({ track }: { track: MediaStreamTrack }) {
  const [rate, setRate] = useState<CaptureRate>(REALTIME_RATE);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function change(next: CaptureRate) {
    if (busy || next === rate) return;
    setFailed(false); setBusy(true);
    try {
      await track.applyConstraints({ ...track.getConstraints(), frameRate: captureFrameRate(next) });
      setRate(next);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <div className="fw-capture-rate"><label title="Requested rate, not measured FPS. Try Lower load if this PC struggles with the shared window.">
    Capture target <select value={rate} disabled={busy || typeof track.applyConstraints !== 'function'} onChange={e => void change(Number(e.target.value) as CaptureRate)}>
      <option value="60">Real-time · 60 fps</option><option value="30">Lower load · 30 fps</option>
    </select>
  </label>{failed && <small role="status">Rate change unavailable. Sharing continues at the previous setting.</small>}</div>;
}
