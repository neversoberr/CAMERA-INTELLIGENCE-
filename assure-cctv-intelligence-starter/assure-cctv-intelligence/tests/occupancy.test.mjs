import test from 'node:test';
import assert from 'node:assert/strict';
import { tileBounds, usableView, classify } from '../public/occupancy/analysis.mjs';

test('rectangular grids cover odd-sized frames exactly once in reading order', () => {
  const width = 137, height = 89, pixels = new Uint8Array(width * height);
  for (let i = 0; i < 6; i++) {
    const { x, y, w, h } = tileBounds(i, 3, 2, width, height);
    assert.equal(x, Math.floor(i % 3 * width / 3));
    assert.equal(y, Math.floor(Math.floor(i / 3) * height / 2));
    for (let b = y; b < y + h; b++) for (let a = x; a < x + w; a++) pixels[b * width + a]++;
  }
  assert.ok(pixels.every(n => n === 1));
});

test('blank, low-light and tiny frames are not usable evidence of vacancy', () => {
  const rgba = new Uint8Array(90 * 90 * 4);
  assert.equal(usableView(rgba, 90, 90), false);
  rgba.fill(220); assert.equal(usableView(rgba, 90, 90), false);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 21;
  assert.equal(usableView(rgba, 90, 90), false);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 255;
  assert.equal(usableView(rgba, 90, 90), true);
  assert.equal(usableView(rgba, 12, 12), false);
});

const det = (categoryName, score) => ({ categories: [{ categoryName, score }], boundingBox: { originX: -10, originY: 20, width: 70, height: 110 } });
test('only confident person detections imply occupied; ambiguous people are unclear', () => {
  assert.equal(classify([], 100, 100).state, 'empty');
  assert.equal(classify([det('chair', 0.98)], 100, 100).state, 'empty');
  assert.equal(classify([det('person', 0.30)], 100, 100).state, 'unclear');
  assert.deepEqual(classify([det('person', 0.91)], 100, 100), { state: 'occupied', boxes: [{ x: 0, y: 0.2, w: 0.6, h: 0.8 }] });
});
