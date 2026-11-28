import { DESKTOP_RECORDER } from '@/lib/monitor/platform';
export type Camera = { id: string; fps: number | null; detectionFps: number | null; streams: string[] };
export type RecorderEvent = {
  id: string;
  camera: string;
  label: string;
  start_time: number;
  end_time: number | null;
  has_snapshot: boolean;
  has_clip: boolean;
  zones: string[] | null;
};
export type RecorderState = {
  connected: true;
  address: string;
  version?: string;
  updated: number;
  cameras: Camera[];
  events: RecorderEvent[];
};
export type Connection = RecorderState | { connected: false };
export class RecorderError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function callRecorder<T>(
  operation: 'state' | 'connect' | 'disconnect' | 'live' | 'quit',
  signal: AbortSignal,
  payload?: object,
): Promise<T> {
  if (!DESKTOP_RECORDER) throw new Error('Launch Framewatch.exe to connect a recorder.');
  const res = await fetch(`./api/${operation}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  const value = await res.json();
  if (!res.ok)
    throw new RecorderError(
      typeof value.error === 'string' ? value.error : 'Recorder request unsuccessful.',
      res.status,
    );
  return value as T;
}
export const mediaURL = (kind: 'camera' | 'snapshot' | 'clip', id: string) =>
  `./api/media/${kind}/${encodeURIComponent(id)}`;
export const friendly = (name: string) => name.replace(/[_-]/g, ' ');
export function demoRecorder(): RecorderState {
  const now = Date.now(),
    ids = ['reception', 'meeting_room', 'workspace', 'corridor'];
  return {
    connected: true,
    address: 'Sample recorder',
    version: 'Sample',
    updated: now,
    cameras: ids.map((id, i) => ({
      id,
      fps: [25, 20, 25, 0][i],
      detectionFps: [5, 3, 4, 0][i],
      streams: [id],
    })),
    events: [0, 2, 0].map((i, j) => ({
      id: `sample-${j}`,
      camera: ids[i],
      label: 'person',
      start_time: now / 1000 - (j + 1) * 275,
      end_time: now / 1000 - (j + 1) * 275 + 17,
      has_snapshot: true,
      has_clip: false,
      zones: [i === 0 ? 'entrance' : 'desks'],
    })),
  };
}
