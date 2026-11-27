// Comparable playback probe for the hosted monitor and extracted PC releases.
// Feed a genuine MediaStream a changing binary frame number (same source rate,
// even for older builds). Don't replace inference or time its progress messages as frames.
export async function installMovingWall(page, fps = 30) {
  await page.evaluate(async fps => {
    const img = document.querySelector('img.fw-frame'); await img.decode();
    const wall = document.createElement('canvas'); wall.width = 640; wall.height = 360;
    const ctx = wall.getContext('2d', { alpha: false, willReadFrequently: true }); ctx.drawImage(img, 0, 0, wall.width, wall.height);
    const x = 24, y = 28, bits = 12, dot = 8;
    const probe = window.previewProbe = { produced: 0, started: 0, completed: 0, maxPending: 0 };
    window.Worker = class extends Worker {
      constructor(...args) {
        super(...args); this.pending = 0;
        this.addEventListener('message', ({data}) => { if (data.readings && this.pending) { this.pending--; probe.completed++; } });
      }
      postMessage(data, ...rest) {
        if (data.live && data.frame) { probe.started++; probe.maxPending = Math.max(probe.maxPending, ++this.pending); }
        return super.postMessage(data, ...rest);
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async constraints => {
      probe.constraints = constraints; probe.picks = (probe.picks || 0) + 1;
      const stream = wall.captureStream(0), track = probe.track = stream.getVideoTracks()[0];
      const paint = () => {
        const id = ++probe.produced;
        for (let i=0; i<bits; i++) { ctx.fillStyle = (id >> i) & 1 ? 'white' : 'black'; ctx.fillRect(x+i*dot, y, dot, dot); }
        track.requestFrame();
      };
      const timer = setInterval(() => track.readyState === 'ended' ? clearInterval(timer) : paint(), 1000/fps);
      paint(); return stream;
    } });
    // Sample only the media element actually displayed inside the wall, not the
    // hidden input or video.currentTime (which can advance on a frozen picture).
    probe.measure = ms => new Promise(resolve => {
      const mini = document.createElement('canvas'); mini.width = bits; mini.height = 1;
      const c = mini.getContext('2d', {willReadFrequently:true}); c.imageSmoothingEnabled = false;
      const start = performance.now(), produced = probe.produced, completed = probe.completed;
      let last = null, lastSweep = 0, changes = 0, duringSweep = 0, samples = 0;
      const read = now => {
        const stage = document.querySelector('.fw-stage');
        const el = [...stage.querySelectorAll('canvas, video')].find(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        if (el && !stage.querySelector('.fw-no-frame') && (el.tagName !== 'VIDEO' || el.readyState >= 2)) {
          const sx = (el.videoWidth || el.width) / wall.width, sy = (el.videoHeight || el.height) / wall.height;
          c.drawImage(el, sx*x, sy*(y+dot/2), sx*bits*dot, Math.max(1,sy), 0,0,bits,1);
          const data = c.getImageData(0,0,bits,1).data; let id = 0;
          for (let i=0; i<bits; i++) if (data[4*i] > 128) id |= (1 << i);
          // Count consecutive changed pictures inside the SAME outstanding job.
          const sweep = probe.started > probe.completed ? probe.started : 0;
          if (last !== null && id !== last) {
            changes++;
            if (sweep && lastSweep === sweep) duringSweep++;
          }
          last = id; lastSweep = sweep; samples++;
        }
        if (now-start < ms) requestAnimationFrame(read);
        else resolve({ ms: Math.round(now-start), changes, duringSweep, samples, produced: probe.produced-produced, sweeps: probe.completed-completed, maxPending: probe.maxPending });
      };
      requestAnimationFrame(read);
    });
  }, fps);
}
export const measureMotion = (page, ms) => page.evaluate(ms => window.previewProbe.measure(ms), ms);
