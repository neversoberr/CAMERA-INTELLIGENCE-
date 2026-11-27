// Replace only the picker. By default both old and new releases get the same
// 30 Hz input; the optional latency bench lets Chromium cap canvas capture at
// the requested rate while the synthetic SOURCE keeps changing at ~60 Hz.
export async function installMovingWall(page, fps = 30, honourTarget = false) {
  await page.evaluate(async ({fps, honourTarget}) => {
    const img = document.querySelector('img.fw-frame'); await img.decode();
    const wall = document.createElement('canvas'); wall.width = 640; wall.height = 360;
    const ctx = wall.getContext('2d', { alpha: false, willReadFrequently: true }); ctx.drawImage(img, 0, 0, wall.width, wall.height);
    const x = 24, y = 28, bits = 12, dot = 8;
    const painted = new Float64Array(1 << bits);
    const probe = window.previewProbe = { produced: 0, started: 0, completed: 0, maxPending: 0, freeze: false };
    window.Worker = class extends Worker {
      constructor(...args) {
        super(...args); this.pending = 0;
        this.addEventListener('message', ({data}) => { if (data.readings && this.pending) { this.pending--; probe.completed++; if (probe.checkEvidence) probe.lastCheckedId = this.submittedId; } });
      }
      postMessage(data, ...rest) {
        if (data.live && data.frame) { if (probe.checkEvidence) this.submittedId = marker(data.frame); probe.started++; probe.maxPending = Math.max(probe.maxPending, ++this.pending); }
        return super.postMessage(data, ...rest);
      }
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async constraints => {
      probe.constraints = constraints; probe.picks = (probe.picks || 0) + 1;
      const rate = honourTarget ? Math.min(fps, constraints.video.frameRate.ideal) : 0;
      const stream = wall.captureStream(rate), track = probe.track = stream.getVideoTracks()[0];
      const paint = () => {
        if (probe.freeze) return;
        const id = ++probe.produced;
        for (let i=0; i<bits; i++) { ctx.fillStyle = (id >> i) & 1 ? 'white' : 'black'; ctx.fillRect(x+i*dot, y, dot, dot); }
        painted[id % painted.length] = performance.now();
        if (!honourTarget) track.requestFrame();
      };
      const timer = setInterval(() => track.readyState === 'ended' ? clearInterval(timer) : paint(), 1000/fps);
      paint(); return stream;
    } });
    const mini = document.createElement('canvas'); mini.width = bits; mini.height = 1;
    const c = mini.getContext('2d', {willReadFrequently:true}); c.imageSmoothingEnabled = false;
    const marker = el => {
      const sx = (el.videoWidth || el.width) / wall.width, sy = (el.videoHeight || el.height) / wall.height;
      c.drawImage(el, sx*x, sy*(y+dot/2), sx*bits*dot, Math.max(1,sy), 0,0,bits,1);
      const data = c.getImageData(0,0,bits,1).data; let id = 0;
      for (let i=0; i<bits; i++) if (data[4*i] > 128) id |= (1 << i);
      return id;
    };
    const readId = () => {
      const stage = document.querySelector('.fw-stage');
      const el = [...stage.querySelectorAll('canvas, video')].find(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      if (!el || stage.querySelector('.fw-no-frame') || (el.tagName === 'VIDEO' && el.readyState < 2)) return null;
      return marker(el);
    };
    probe.displayedId = readId;
    probe.measure = ms => new Promise(resolve => {
      const start = performance.now(), produced = probe.produced, completed = probe.completed, ages = [];
      let last = null, lastSweep = 0, changes = 0, duringSweep = 0, samples = 0;
      const read = now => {
        const id = readId();
        if (id !== null) {
          // Includes repeated markers, so a smooth-but-delayed or frozen picture
          // doesn't get a good age just because its video clock advanced.
          if (painted[id]) ages.push(performance.now() - painted[id]);
          const sweep = probe.started > probe.completed ? probe.started : 0;
          if (last !== null && id !== last) {
            changes++;
            if (sweep && lastSweep === sweep) duringSweep++;
          }
          last = id; lastSweep = sweep; samples++;
        }
        if (now-start < ms) requestAnimationFrame(read);
        else {
          ages.sort((a,b)=>a-b);
          const q = p => ages.length ? Math.round(ages[Math.floor(p * (ages.length - 1))]) : null;
          resolve({ ms: Math.round(now-start), changes, duringSweep, samples, produced: probe.produced-produced,
            visiblePixelAgeMs: { median: q(.5), p95: q(.95) }, sweeps: probe.completed-completed, maxPending: probe.maxPending });
        }
      };
      requestAnimationFrame(read);
    });
    probe.measureRecovery = () => new Promise((resolve,reject) => {
      // Resume immediately after the app displays its stale-feed overlay. Time
      // the first new SOURCE paint to visible NEW pixels, not a timer or a label.
      let first = null; probe.freeze = true;
      const deadline = performance.now() + 12000;
      const tick = () => {
        if (performance.now() > deadline) { probe.freeze = false; reject(Error('Missing capture stall or recovery')); return; }
        if (first === null && document.querySelector('.fw-no-frame')) { first = probe.produced+1; probe.freeze = false; }
        else if (first !== null && probe.produced >= first) {
          const id = readId(), resumedAt = painted[first % painted.length];
          if (id !== null && painted[id] >= resumedAt) { resolve(Math.round(performance.now() - resumedAt)); return; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, {fps, honourTarget});
}
export const measureMotion = (page, ms) => page.evaluate(ms => window.previewProbe.measure(ms), ms);
export const measureRecovery = page => page.evaluate(() => window.previewProbe.measureRecovery());
