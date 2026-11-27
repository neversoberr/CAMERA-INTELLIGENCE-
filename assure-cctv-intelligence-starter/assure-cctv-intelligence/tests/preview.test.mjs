import test from 'node:test';
import assert from 'node:assert/strict';
import { frameRegion, videoViewport } from '../lib/monitor/frame-region.ts';
import { watchFrames } from '../lib/monitor/live-frames.ts';

test('live viewport and analysis use the same crop, including odd pixel sizes and edge clamping', () => {
  for (const [W,H,crop] of [[1600,900,{x:0,y:0,w:1,h:1}], [1919,1079,{x:.17,y:.11,w:.68,h:.8}], [13,9,{x:.92,y:.89,w:.09,h:.12}]]) {
    const {x,y,w,h}=frameRegion(W,H,crop), {ratio,style}=videoViewport(W,H,crop);
    assert.equal(x,Math.floor(crop.x*W)); assert.equal(y,Math.floor(crop.y*H)); assert.ok(w>=1&&x+w<=W&&h>=1&&y+h<=H);
    assert.equal(ratio,w/h);
    const n=k=>parseFloat(style[k])/100;
    assert.ok(Math.abs(n('left')+n('width')*x/W)<1e-9); assert.ok(Math.abs(n('top')+n('height')*y/H)<1e-9);
    assert.ok(Math.abs(n('left')+n('width')*(x+w)/W-1)<1e-9); assert.ok(Math.abs(n('top')+n('height')*(y+h)/H-1)<1e-9);
  }
});

test('the preview counter uses delivered frames, not the requested capture rate or dropped frames', () => {
  const v=new EventTarget(), track=new EventTarget(); v.readyState=4; track.readyState='live'; track.enabled=true;
  let total=20,dropped=1; v.getVideoPlaybackQuality=()=>({totalVideoFrames:total,droppedVideoFrames:dropped});
  const clock=watchFrames(v,track);
  try { const a=clock.read(); assert.equal(a.frames,19); total++; dropped++; assert.deepEqual(clock.read(),a);
    total+=3; const b=clock.read(); assert.equal(b.frames,22); assert.ok(b.token>a.token);
  } finally { clock.close(); }
});
