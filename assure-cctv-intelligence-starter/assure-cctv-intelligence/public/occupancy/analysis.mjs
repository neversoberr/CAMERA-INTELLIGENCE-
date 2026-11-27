// All geometry is relative to one camera. No identities or cross-camera tracks.
export const WHOLE = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const THUMB_W = 64, THUMB_H = 40;
export const PERSON_FLOOR = 0.23;
const NEGATIVE_ZOOM_TTL = 4000;
const clamp = n => Math.max(0, Math.min(1, n));

// Round shared edges rather than widths: odd-sized frames have no gaps or overlap.
export function tileBounds(index, cols, rows, width, height) {
  const col = index % cols, row = Math.floor(index / cols);
  const x = Math.floor(col * width / cols), y = Math.floor(row * height / rows);
  return { x, y, w: Math.floor((col + 1) * width / cols) - x, h: Math.floor((row + 1) * height / rows) - y };
}

// One small readback for the entire wall feeds both the quality gate and cache.
// Use the centre for quality (a timestamp is not a usable feed), but keep the
// entire tile in the change signature so a person can enter from any edge.
export function inspectTile(rgba, stride, left, top) {
  const signature = new Uint8Array(THUMB_W * THUMB_H), hist = new Uint16Array(256);
  let count = 0;
  for (let y = 0, k = 0; y < THUMB_H; y++) {
    let p = 4 * ((top + y) * stride + left);
    for (let x = 0; x < THUMB_W; x++, k++, p += 4) {
      const lum = (77 * rgba[p] + 150 * rgba[p+1] + 29 * rgba[p+2]) >>> 8;
      signature[k] = lum;
      if (x >= 2 && x < THUMB_W - 2 && y >= 2 && y < THUMB_H - 2) { hist[lum]++; count++; }
    }
  }
  let low = 0, high = 255, dark = 0, bright = 0;
  while (low < 255 && (dark += hist[low]) < count * 0.05) low++;
  while (high > 0 && (bright += hist[high]) < count * 0.05) high--;
  return { signature, usable: high >= 25 && high - low >= 12 };
}

export function sameView(a, b, region = WHOLE) {
  if (!a || a.length !== b.length) return false;
  const x0 = Math.floor(region.x * THUMB_W), x1 = Math.min(THUMB_W, Math.ceil((region.x + region.w) * THUMB_W));
  const y0 = Math.floor(region.y * THUMB_H), y1 = Math.min(THUMB_H, Math.ceil((region.y + region.h) * THUMB_H));
  let changed = 0, sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * THUMB_W + x;
    const delta = Math.abs(a[i] - b[i]);
    // Local changes matter more than their average over a whole empty room.
    if (delta > 22 || (delta >= 8 && ++changed >= 4)) return false;
    sum += delta;
  }
  return sum <= (x1 - x0) * (y1 - y0) * 1.4;
}

export function mayReuse(last, signature, now, index) {
  // Expiration is from the last *neural* scan, not from the last cache hit.
  // Stagger the deadlines slightly. Motion is never a substitute for detection.
  if (last?.reading.state === 'empty' && last.negatives?.some(z => z && now - z.at >= NEGATIVE_ZOOM_TTL)) return false;
  return !!last && (last.reading.state === 'empty' || last.reading.state === 'occupied') &&
    now >= last.at && now - last.at < 2500 - (index % 4) * 100 && sameView(last.signature, signature);
}

// We can reuse only a recent *negative* zoom pass in Balanced/live. Full-view
// scans still run on their shorter deadline. Never recycle a hit as new evidence.
export function mayReuseNegative(last, signature, region, now) {
  return !!last && now >= last.at && now - last.at < NEGATIVE_ZOOM_TTL && sameView(last.signature, signature, region);
}

export function zoomWindows(mode, width, height) {
  if (mode === 'fast' || Math.min(width, height) < 96 || Math.max(width, height) < 200) return [];
  const side = 0.62, end = 1 - side;
  if (mode === 'detail') return [0, end].flatMap(y => [0, end].map(x => ({ x, y, w: side, h: side })));
  return width >= height ? [0, end].map(x => ({ x, y: 0, w: side, h: 1 })) : [0, end].map(y => ({ x: 0, y, w: 1, h: side }));
}

// Map boxes from the *actual integer pixel crop* back to the original camera.
// Clipped boxes on INTERNAL zoom boundaries need stronger evidence; people on
// the true edge of a camera are not penalised merely for being at that edge.
export function observations(detections, width, height, region = WHOLE, pass = 0) {
  const hits = []; let unlocated = false;
  for (const { categories, boundingBox: b } of detections) {
    const person = categories.find(c => c.categoryName === 'person');
    if (!person) continue;
    const score = person.score;
    if (!Number.isFinite(score) || score < 0 || score > 1) { unlocated = true; continue; }
    if (score < PERSON_FLOOR) continue;
    if (!b || ![b.originX, b.originY, b.width, b.height].every(Number.isFinite)) { unlocated = true; continue; }
    const x = clamp(b.originX / width), y = clamp(b.originY / height);
    const r = clamp((b.originX + b.width) / width), d = clamp((b.originY + b.height) / height);
    if (r <= x || d <= y) { unlocated = true; continue; }
    const clipped = (region.x > 0 && x < 0.02) || (region.y > 0 && y < 0.02) ||
      (region.x + region.w < 0.9999 && r > 0.98) || (region.y + region.h < 0.9999 && d > 0.98);
    hits.push({ score, pass, clipped, box: { x: region.x + x * region.w, y: region.y + y * region.h, w: (r-x) * region.w, h: (d-y) * region.h } });
  }
  return { hits, unlocated };
}

function matches(left, right) {
  const a = left.box, b = right.box;
  const common = Math.max(0, Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y));
  const aa = a.w*a.h, ba = b.w*b.h;
  if (common >= 0.42 * (aa + ba - common)) return true;
  if (common < 0.8 * Math.min(aa, ba)) return false;
  const ratio = Math.min(aa, ba) / Math.max(aa, ba);
  // A zoom boundary may cut off the upper/lower body. Prefer the whole box
  // when this smaller, edge-clipped observation agrees on horizontal position.
  return ratio >= 0.45 || (ratio >= 0.2 && left.pass !== right.pass && (aa < ba ? left : right).clipped &&
    Math.abs((a.x + a.w/2) - (b.x + b.w/2)) <= 0.32 * Math.max(a.w, b.w));
}

// Cross-scale agreement can recover a weak full-view person. Repeated boxes
// from the SAME pass do not count as independent support. Keep actual model
// scores (not invented probabilities), and suppress duplicate overlay boxes.
export function resolvePeople(passes) {
  const sorted = passes.flatMap(p => p.hits).sort((a, b) => b.score - a.score);
  const groups = [];
  for (const hit of sorted) {
    const group = groups.find(g => matches(g[0], hit));
    if (group) group.push(hit); else groups.push([hit]);
  }
  const boxes = []; let best = 0;
  for (const group of groups) {
    const strong = group.some(h => h.score >= (h.pass === 0 ? 0.35 : h.clipped ? 0.50 : 0.42));
    const supported = new Set(group.filter(h => h.score >= 0.28 && !h.clipped).map(h => h.pass)).size >= 2;
    if (!strong && !supported) continue;
    boxes.push((group.find(h => !h.clipped) ?? group[0]).box);
    best = Math.max(best, group[0].score);
  }
  if (boxes.length) return { state: 'occupied', reason: 'person', score: best, boxes };
  if (passes.some(p => p.unlocated) || sorted.some(h => h.score >= (h.pass === 0 ? PERSON_FLOOR : 0.30))) {
    return { state: 'unclear', reason: 'weak', boxes: [] };
  }
  return { state: 'empty', reason: 'no-person', boxes: [] };
}

// Hysteresis only for a live source. After a person or weak evidence, require
// fresh negative inferences on two different video frames before clearing the
// view. Never draw an old person's box on a new frame while confirming vacancy.
export function settleLive(raw, last, frameToken) {
  if (raw.state === 'occupied' || raw.reason === 'weak') return { reading: raw, guard: true, miss: null };
  if (raw.state !== 'empty') return { reading: raw, guard: !!last?.guard, miss: null };
  if (last?.guard && (last.miss == null || last.miss === frameToken)) {
    return { reading: { state: 'unclear', reason: 'confirming-empty', boxes: [] }, guard: true, miss: frameToken };
  }
  return { reading: raw, guard: false, miss: null };
}
