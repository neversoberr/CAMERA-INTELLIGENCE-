// A preference for the local window capture, not the camera's frame rate.
// Never require a minimum, downscale the detector input or add another track.
export type CaptureRate = 30 | 60;
export const REALTIME_RATE: CaptureRate = 60;
export function captureFrameRate(rate: CaptureRate): ConstrainDoubleRange {
  return rate === 30 ? { ideal: 30, max: 30 } : { ideal: 60 };
}
