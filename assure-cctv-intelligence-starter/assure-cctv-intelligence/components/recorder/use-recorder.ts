'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DESKTOP_RECORDER } from '@/lib/monitor/platform';
import { callRecorder, RecorderError, type Connection, type RecorderState } from '@/lib/recorder/client';
type Action = 'connect' | 'state' | 'disconnect';
export function useRecorder() {
  const [data, setData] = useState<RecorderState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<Action | null>(DESKTOP_RECORDER ? 'state' : null);
  const current = useRef<AbortController | null>(null);
  const act = useCallback(async (action: Action, payload?: object) => {
    if (action === 'state' && current.current) return;
    current.current?.abort();
    const c = new AbortController();
    current.current = c;
    setBusy(action);
    try {
      const result = await callRecorder<Connection>(action, c.signal, payload);
      if (!c.signal.aborted) {
        setData(result.connected ? result : null);
        setError('');
      }
    } catch (e) {
      if (!c.signal.aborted) {
        if (e instanceof RecorderError && e.status === 401) setData(null);
        setError(
          e instanceof RecorderError
            ? e.message
            : 'Cannot reach the local launcher. Keep Framewatch.exe open, then retry.',
        );
      }
    } finally {
      if (current.current === c) {
        current.current = null;
        setBusy(null);
      }
    }
  }, []);
  useEffect(() => {
    if (DESKTOP_RECORDER) void act('state');
    return () => {
      current.current?.abort();
      current.current = null;
    };
  }, [act]);
  const connected = !!data;
  useEffect(() => {
    if (!connected) return;
    const poll = () => {
      if (!document.hidden) void act('state');
    };
    const t = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [connected, act]);
  return { data, error, busy, act };
}
