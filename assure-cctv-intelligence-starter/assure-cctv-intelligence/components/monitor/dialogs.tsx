'use client';
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Bell, Check, Crop, Download, Grid2X2, LockKeyhole, MonitorUp, RotateCcw, ScanLine, X } from 'lucide-react';
import { PC_DOWNLOAD } from '@/lib/monitor/platform';
import { FULL, sourceElement, takeFrame, type Source, type Rect } from '@/lib/monitor/types';

export function Dialog({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={`fw-dialog ${wide ? 'fw-dialog-wide' : ''}`} aria-labelledby={id}
    onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="fw-dialog-inner">
      <div className="fw-dialog-head"><div><div className="fw-eyebrow">{eyebrow}</div><h2 id={id}>{title}</h2></div>
        <button className="fw-icon-btn" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>
      {children}
    </div>
  </dialog>;
}

export function Guide({ onClose }: { onClose: () => void }) {
  return <Dialog title="How to use the monitor" eyebrow="QUICK GUIDE" onClose={onClose}>
    <ol className="fw-guide-steps">
      <li><MonitorUp/><div><h3>Choose your camera screen</h3><p>Share the window or tab containing your CCTV grid, not this monitor. You can also open a PNG, JPG, or WebP screenshot.</p></div></li>
      <li><Grid2X2/><div><h3>Match the grid</h3><p>Choose columns × rows and crop out menus or borders. Cameras are numbered from left to right, starting with the top row.</p></div></li>
      <li><ScanLine/><div><h3>Read the camera status</h3><p>Live video plays the shared window. Labels come from the last check; choose Last scan to see its still frame and person boxes. Empty means no person was detected, not proof of vacancy. Weak or poor views stay unclear.</p></div></li>
      <li><ScanLine/><div><h3>Choose a detection mode</h3><p>Heavy checks every usable camera with two person models and overlapping close-ups. For quicker checks or less CPU use, try Balanced or Fast. Live video does not wait for any of these scans.</p></div></li>
      <li><Grid2X2/><div><h3>Review empty periods</h3><p>Open Vacancy dashboard while sharing or afterwards. Use Name places to label cabins. Each period ends at the last observed empty frame. If you rearrange cameras in the viewer, stop sharing and start a new layout.</p></div></li>
      <li><Bell/><div><h3>Get an empty-cabin reminder</h3><p>Open Reminders, turn on the rule, and choose a delay and place. For a PC banner, also enable desktop notifications and allow the browser prompt. Leave the camera screen shared.</p></div></li>
    </ol>
    <div className="fw-guide-note"><LockKeyhole size={17}/><span>Frames are never saved. Vacancy history and reminder preferences stay in this browser. Export or clear history in the dashboard.</span></div>
    <div className="fw-dialog-actions">
      {PC_DOWNLOAD && <a className="fw-btn" href={PC_DOWNLOAD} download><Download size={15}/>Download for PC</a>}
      <button className="fw-btn fw-primary" onClick={onClose}>Got it <Check size={16}/></button>
    </div>
  </Dialog>;
}

export function CropDialog({ source, current, onApply, onClose }: { source: Source; current: Rect; onApply: (r: Rect) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null), anchor = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState(current), [ratio, setRatio] = useState(16 / 9);
  const [ready, setReady] = useState(false), [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const el = await sourceElement(source); if (cancelled || !ref.current) return;
        takeFrame(el, FULL, ref.current, 1600); setRatio(ref.current.width / ref.current.height); setReady(true);
      } catch { if (!cancelled) setError(true); }
    })(); return () => { cancelled = true; };
  }, [source]);
  function point(e: PointerEvent<HTMLDivElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)) };
  }
  return <Dialog title="Frame the camera grid" eyebrow="SOURCE CROP" wide onClose={onClose}>
    <p className="fw-dialog-intro">Drag around the whole camera grid, leaving out toolbars and side panels.</p>
    <div className="fw-crop-stage" style={{ aspectRatio: ratio, width: `min(100%, ${ratio * 48}vh)` }}
      onPointerDown={e => { if (!ready) return; e.currentTarget.setPointerCapture(e.pointerId); anchor.current = point(e); }}
      onPointerMove={e => { if (!anchor.current) return; const p = point(e), a = anchor.current;
        setRect({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(a.x - p.x), h: Math.abs(a.y - p.y) }); }}
      onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}>
      <canvas ref={ref}/><div className="fw-crop-selection" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}/>
    </div>
    {error && <p role="alert">No source frame is available. Try opening the crop tool again.</p>}
    <details className="fw-crop-inputs"><summary>Set margins by percentage</summary><div>
      {(['Left', 'Top', 'Right', 'Bottom'] as const).map((label, i) => {
        const values = [rect.x, rect.y, 1 - rect.x - rect.w, 1 - rect.y - rect.h];
        return <label key={label}>{label}<input type="number" min="0" max="95" step="1" value={Math.round(values[i] * 100)} onChange={e => {
          const opposite = (i + 2) % 4;
          values[i] = Math.max(0, Math.min(0.95 - values[opposite], Number(e.target.value) / 100));
          setRect({ x: values[0], y: values[1], w: 1 - values[0] - values[2], h: 1 - values[1] - values[3] });
        }}/></label>;
      })}</div></details>
    <div className="fw-dialog-actions"><button className="fw-btn" onClick={() => setRect(FULL)}><RotateCcw size={15}/>Full frame</button>
      <button className="fw-btn fw-primary" disabled={!ready || rect.w < 0.025 || rect.h < 0.025} onClick={() => onApply(rect)}><Crop size={15}/>Apply crop</button></div>
  </Dialog>;
}
