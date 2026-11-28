import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFrame, frameRegion, videoViewport } from '../lib/monitor/frame-region.ts';
import { captureFrameRate, REALTIME_RATE } from '../lib/monitor/capture-rate.ts';
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


test('the real-time target is a preference, not a minimum or an instruction to reduce resolution', () => {
  assert.deepEqual(captureFrameRate(REALTIME_RATE), {ideal:60});
  assert.deepEqual(captureFrameRate(30), {ideal:30, max:30});
  assert.deepEqual(fitFrame(4160,2340,3840), {width:3840,height:2160});
  assert.deepEqual(fitFrame(233,157,1920), {width:233,height:157});
});

test('only the first delivered frame in a fresh epoch wakes the live view, never every frame', () => {
  const v = new EventTarget(), track = new EventTarget(); v.readyState=4; track.readyState='live'; track.enabled=true;
  let cb; v.requestVideoFrameCallback=fn=>{cb=fn; return 1;}; v.cancelVideoFrameCallback=()=>{};
  const clock=watchFrames(v,track), woken=[];
  const off=clock.onResume(()=>woken.push(clock.read()?.frames));
  const frame=n=>cb(performance.now(),{presentedFrames:n,presentationTime:performance.now()});
  frame(1); frame(2); frame(2); assert.deepEqual(woken,[1]);
  track.muted=true; track.dispatchEvent(new Event('mute')); frame(3); assert.equal(clock.read(),null);
  track.muted=false; track.dispatchEvent(new Event('unmute')); frame(4); frame(5); assert.deepEqual(woken,[1,4]);
  off(); track.dispatchEvent(new Event('mute')); frame(6); assert.deepEqual(woken,[1,4]); clock.close();
});
