import test from 'node:test';
import assert from 'node:assert/strict';
import { VacancyJournal, MAX_GAP, PREFIX } from '../lib/monitor/vacancy.ts';
import { watchFrames } from '../lib/monitor/live-frames.ts';
const E = { state: 'empty' }, C = { state: 'empty', cached: true }, U = { state: 'unclear' }, P = { state: 'occupied' };
const storage = () => { const m = new Map(); return { get length(){return m.size}, key:i=>[...m.keys()][i], getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v), removeItem:k=>m.delete(k) }; };

test('periods follow distinct fresh checks independently for every place, never wall time or cached votes', () => {
  const j = new VacancyJournal(), id = j.start(2,1), t = Date.now();
  const observe = (ms, token, a, b) => j.observe(id, t+ms, token, [a,b]);
  observe(0,1,E,P); observe(500,1,E,E); observe(900,2,C,E); observe(1400,3,E,E); observe(2200,4,P,U);
  assert.deepEqual(j.snapshot().layouts[0].periods, [{camera:0,from:t,to:t+1400,end:'occupied'}, {camera:1,from:t+900,to:t+1400,end:'unclear'}]);
  observe(2900,5,E,C); j.finish(id); observe(9000,6,E,E);
  assert.deepEqual(j.snapshot().layouts[0].periods.at(-1),{camera:0,from:t+2900,to:t+2900,end:'stopped'});
});

test('interruptions, time jumps and a new layout cannot bridge unobserved time or reuse place labels', () => {
  const j = new VacancyJournal(), t = Date.now(), one = j.start(1,1);
  j.observe(one,t,1,[E]); j.interrupt(one); j.observe(one,t+100,1,[E]); // frozen frame
  j.observe(one,t+1000,2,[E]); j.observe(one,t+1001+MAX_GAP,3,[E]); j.observe(one,t+900,4,[E]);
  j.rename(one,[' Cabin A ']); const two = j.start(1,1); j.observe(one,t+1500,5,[E]); j.observe(two,t+1700,6,[E]);
  const [current,previous] = j.snapshot().layouts;
  assert.deepEqual(current.names,['']); assert.deepEqual(previous.names,['Cabin A']);
  assert.deepEqual(previous.periods.map(p=>[p.from-t,p.to-t,p.end]), [[0,0,'gap'],[1000,1000,'gap'],[1001+MAX_GAP,1001+MAX_GAP,'gap'],[900,900,'stopped']]);
  assert.equal(current.periods.length,1);
});

test('local restore closes interrupted sessions at their last saved sample; bounded, namespaced storage can be cleared', () => {
  const d = storage(), t = Date.now(), j = new VacancyJournal(); d.setItem('unrelated','keep'); d.setItem(PREFIX+'bad','{');
  d.setItem(PREFIX+'expired',JSON.stringify({began:t-31*86400000,cols:1,rows:1,names:[],periods:[]}));
  j.attach(d); const id = j.start(1,1); j.rename(id,['Boardroom']); j.observe(id,t,1,[E]);
  const k = new VacancyJournal(); k.attach(d); assert.equal(k.snapshot().active,null);
  assert.deepEqual(k.snapshot().layouts.map(l=>[l.names,l.periods]),[[['Boardroom'],[{camera:0,from:t,to:t,end:'archived'}]]]);
  assert.equal(d.getItem(PREFIX+'bad'),null); assert.equal(d.getItem(PREFIX+'expired'),null);
  k.clear(); assert.equal(d.length,1); assert.equal(d.getItem('unrelated'),'keep');
});

test('storage failure leaves monitoring usable in memory and no camera pixels are persisted', () => {
  const d = storage(), j = new VacancyJournal(); d.setItem=()=>{throw Error('blocked')}; j.attach(d);
  const id=j.start(1,1); j.observe(id,Date.now(),1,[{state:'empty',boxes:[{x:5}],score:0.2}]);
  assert.equal(j.snapshot().temporary,true); assert.equal(j.snapshot().layouts[0].periods.length,1); assert.doesNotMatch(JSON.stringify(j.snapshot()),/boxes|score/);
});

test('frame clock rejects stalled delivery, mute and a playback clock that advances without a video frame', () => {
  const v = new EventTarget(), track = new EventTarget(); track.readyState='live'; track.enabled=true; v.readyState=4;
  let cb; v.requestVideoFrameCallback=fn=>{cb=fn;return 1}; v.cancelVideoFrameCallback=()=>{};
  const frames=watchFrames(v,track), now=performance.now(); cb(now,{presentedFrames:1,presentationTime:now-5000}); assert.equal(frames.read(),null);
  cb(now,{presentedFrames:2,presentationTime:now}); const first=frames.read(); v.currentTime=900; assert.deepEqual(frames.read(),first);
  track.dispatchEvent(new Event('mute')); assert.equal(frames.read(),null); cb(now,{presentedFrames:3,presentationTime:now}); assert.ok(frames.read().epoch>first.epoch); frames.close();
});

test('retention bounds stored layouts and periods, preserves a long open period, and purges old entries on disk', () => {
  const d=storage(), j=new VacancyJournal(), now=Date.now(); j.attach(d);
  for(let i=0;i<21;i++) j.start(1,1);
  const id=j.start(2,1); assert.equal(d.length,20);
  const t=now-2000; for(let i=0;i<1010;i++) j.observe(id,t+i,i,[E,i%2?P:E]);
  const periods=j.snapshot().layouts[0].periods; assert.equal(periods.length,500); assert.ok(periods.some(p=>p.from===t&&p.to===t+1009&&p.camera===0));
  j.finish(id); const saved=JSON.parse(d.getItem(PREFIX+id)); saved.periods.unshift({camera:1,from:now-31*86400000,to:now-31*86400000,end:'gap'});
  d.setItem(PREFIX+id,JSON.stringify(saved)); new VacancyJournal().attach(d); assert.equal(JSON.parse(d.getItem(PREFIX+id)).periods.length,500);
});
