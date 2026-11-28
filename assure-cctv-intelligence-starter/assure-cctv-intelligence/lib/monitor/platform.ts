// The hosted app serves its resources from the same origin. The PC packager
// substitutes portable/platform.ts at build time; the monitor itself is shared.
export const SAMPLE_URL = '/demo/camera-wall.webp';
export const HOME_URL = '/';
export const PC_DOWNLOAD: string | null = '/downloads/Framewatch-PC.zip';
export const createAnalysisWorker = () => new Worker('/occupancy/worker.js');
// Recorder credentials are accepted only by the installed loopback desktop shell.
export const DESKTOP_RECORDER = false;
