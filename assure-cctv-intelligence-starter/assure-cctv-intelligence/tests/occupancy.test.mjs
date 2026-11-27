import test from 'node:test';
import assert from 'node:assert/strict';
import { tileBounds, inspectTile, sameView, mayReuse, mayReuseNegative, observations, resolvePeople, zoomWindows, settleLive, WHOLE, THUMB_W, THUMB_H } from '../public/occupancy/analysis.mjs';

test('rectangular grids cover odd-sized frames exactly once in reading order', () => {
  const width = 137, height = 89, pixels = new Uint8Array(width * height);
  for (let i = 0; i < 6; i++) {
    const { x, y, w, h } = tileBounds(i, 3, 2, width, height);
    assert.equal(x, Math.floor(i % 3 * width / 3)); assert.equal(y, Math.floor(Math.floor(i / 3) * height / 2));
    for (let b = y; b < y + h; b++) for (let a = x; a < x + w; a++) pixels[b * width + a]++;
  }
  assert.ok(pixels.every(n => n === 1));
});

test('quality is independent per tile; a bright border does not make a blank camera usable', () => {
  const stride = THUMB_W * 2, rgba = new Uint8Array(stride * THUMB_H * 4);
  for (let y = 0; y < THUMB_H; y++) for (let x = 0; x < stride; x++) {
    const i = (y * stride + x) * 4, l = x >= THUMB_W ? (x * y) % 255 : x === 0 || y === 0 ? 253 : 6;
    rgba.fill(l, i, i + 3);
  }
  assert.equal(inspectTile(rgba, stride, 0, 0).usable, false);
  assert.equal(inspectTile(rgba, stride, THUMB_W, 0).usable, true);
  rgba.fill(240); assert.equal(inspectTile(rgba, stride, 0, 0).usable, false);
});

const empty = { state: 'empty', reason: 'no-person', boxes: [] };
const occupied = { state: 'occupied', reason: 'person', boxes: [{ x: 0.2, y: 0, w: 0.4, h: 1 }] };
const poor = { state: 'unclear', reason: 'poor-view', boxes: [] };
test('small local changes, ambiguous readings and TTL force neural checks; hits cannot extend expiry', () => {
  const sig = new Uint8Array(THUMB_W*THUMB_H).fill(84), last = { signature: sig, reading: empty, at: 1000 };
  const b = sig.slice(); b[0] += 7; assert.ok(sameView(sig, b));
  assert.ok(mayReuse(last, b, 1600, 3)); assert.equal(mayReuse(last, b, 3500, 0), false);
  assert.equal(mayReuse({ ...last, reading: poor }, b, 1600, 1), false);
  b[0] += 30; assert.equal(mayReuse(last, b, 1600, 0), false);
  const [left, right] = zoomWindows('balanced', 800, 450);
  assert.equal(mayReuseNegative(last, b, left, 1600), false); assert.equal(mayReuseNegative(last, b, right, 1600), true);
  assert.equal(mayReuseNegative(last, b, right, 5000), false);
  assert.equal(mayReuse({ ...last, at: 4600, negatives: [last] }, sig, 5000, 0), false); // a recent whole scan cannot prolong expired zoom evidence
});

test('profile budgets are finite and zoom windows cover the whole tile, including seams', () => {
  for (const [w,h] of [[600,400],[360,640]]) for (const [mode,n] of [['fast',0],['balanced',2],['detail',4]]) {
    const windows = zoomWindows(mode,w,h); assert.equal(windows.length,n);
    if(n) for(let i=0;i<=100;i++) for(let j=0;j<=100;j++) assert.ok(windows.some(r=>r.x<=i/100&&r.y<=j/100&&r.x+r.w>=i/100&&r.y+r.h>=j/100));
  }
  assert.deepEqual(zoomWindows('detail',96,80),[]);
});

const det = (name, score, x = 20, y = 10, w = 25, h = 60) => ({ categories: [{ categoryName: name, score }], boundingBox: { originX: x, originY: y, width: w, height: h } });
const scan = (d, r=WHOLE, id=0) => observations(d,100,100,r,id);
test('only persons count; unusable boxes and weak evidence cannot declare occupancy', () => {
  assert.equal(resolvePeople([scan([det('chair',0.99)])]).state,'empty');
  for (const b of [det('person',0.29), det('person',0.85,NaN),det('person',0.91,110)]) assert.equal(resolvePeople([scan([b])]).state,'unclear');
  const result=resolvePeople([scan([det('person',0.92,-10,20,70,100)])]);
  assert.deepEqual(result.boxes,[{x:0,y:0.2,w:0.6,h:0.8}]); assert.equal(result.score,0.92);
});

test('inverse-maps zooms and fuses distinct corroborating passes, not same-pass duplicates', () => {
  const weak=det('person',0.30,60,10,20,60);
  const whole=scan([weak,weak]); assert.equal(resolvePeople([whole]).state,'unclear');
  const right=scan([det('person',0.32,20,10,40,60)],{x:0.5,y:0,w:0.5,h:1},1);
  const res=resolvePeople([whole,right]); assert.equal(res.state,'occupied'); assert.equal(res.boxes.length,1);
  const box=res.boxes[0]; assert.ok(Math.abs(box.x-0.6)<1e-8 && Math.abs(box.w-0.2)<1e-8);
  const other=scan([det('person',0.90,10,10,15,60)]); assert.equal(resolvePeople([whole,right,other]).boxes.length,2);
});

test('live vacancy confirmation needs distinct modelled frames; no ghost box on misses or signal loss', () => {
  const hit=settleLive(occupied,null,1), miss=settleLive(empty,hit,2);
  assert.equal(miss.reading.reason,'confirming-empty'); assert.deepEqual(miss.reading.boxes,[]);
  assert.equal(settleLive(empty,miss,2).reading.state,'unclear'); assert.equal(settleLive(empty,miss,3).reading.state,'empty');
  const lost=settleLive(poor,miss,3); assert.deepEqual(lost.reading,poor); assert.equal(settleLive(empty,lost,4).reading.state,'unclear');
  assert.equal(settleLive(occupied,miss,3).reading.state,'occupied');
  assert.equal(settleLive(empty,null,2).reading.state,'empty'); // new source does not inherit history
});

test('weak crop-edge partials need stronger support and do not duplicate a whole person', () => {
  const lower = { x: 0, y: 0.4, w: 1, h: 0.6 };
  const clipped = scan([det('person',0.44,42,0,10,38)], lower, 2);
  assert.equal(resolvePeople([clipped]).state, 'unclear');
  const full = scan([det('person',0.39,40,10,14,55)]);
  const supported = resolvePeople([full, scan([det('person',0.56,42,0,10,38)], lower, 2)]);
  assert.equal(supported.boxes.length,1); assert.deepEqual(supported.boxes[0],full.hits[0].box);
});
