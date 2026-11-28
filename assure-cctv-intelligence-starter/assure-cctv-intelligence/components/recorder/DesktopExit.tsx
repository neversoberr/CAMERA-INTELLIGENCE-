'use client';
import { useState } from 'react';
import { Power } from 'lucide-react';
import { Dialog } from '../monitor/dialogs';
import { callRecorder } from '@/lib/recorder/client';

export function DesktopExit({ onExit }: { onExit: () => void }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      await callRecorder('quit', AbortSignal.timeout(6000), {});
      onExit();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="fw-icon-btn"
        title="Quit desktop app"
        aria-label="Quit desktop app"
        onClick={() => setOpen(true)}
      >
        <Power size={17} />
      </button>
      {open && (
        <Dialog
          title="Quit Framewatch?"
          eyebrow="DESKTOP SESSION"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p>The local launcher will close, disconnect Frigate and stop screen monitoring in this window.</p>
          {failed && (
            <p role="alert">The launcher did not respond. Close its console and this window to quit.</p>
          )}
          <div className="fw-dialog-actions">
            <button className="fw-btn" disabled={busy} onClick={() => setOpen(false)}>
              Keep open
            </button>
            <button className="fw-btn fw-stop" disabled={busy} onClick={() => void leave()}>
              Quit Framewatch
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
