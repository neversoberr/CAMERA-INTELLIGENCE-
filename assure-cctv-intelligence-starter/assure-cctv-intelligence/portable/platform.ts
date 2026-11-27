// file:// pages cannot fetch sibling models or start a worker from a file URL.
// Both payloads below are owned by the build, never derived from a camera frame.
function takePayload(id: string) {
  const node = document.getElementById(id);
  if (!node?.textContent) throw new Error('The PC copy is incomplete. Extract Framewatch.html again.');
  const value = node.textContent;
  node.remove();
  return value;
}
export const SAMPLE_URL = takePayload('fw-sample');
export const HOME_URL = location.href;
export const PC_DOWNLOAD: string | null = null;
let workerURL: string | undefined;
export function createAnalysisWorker() {
  // A page-lifetime URL avoids recopying the model when the user changes grids.
  // Browsers release it with the document; each analysis still owns its worker.
  workerURL ??= URL.createObjectURL(new Blob([takePayload('fw-worker')], { type: 'text/javascript' }));
  return new Worker(workerURL);
}
