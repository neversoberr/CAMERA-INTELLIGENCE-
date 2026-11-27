import test from 'node:test';
import assert from 'node:assert/strict';
import { VacancyJournal, MAX_GAP } from '../lib/monitor/vacancy.ts';
import { ReminderGate, DEFAULT_PREFS, readPreferences } from '../lib/monitor/reminders.ts';
const E = { state: 'empty' }, C = { state: 'empty', cached: true }, P = { state: 'occupied' }, U = { state: 'unclear' };

function monitor(prefs) {
  const settings = { ...DEFAULT_PREFS, ...prefs }, journal = new VacancyJournal(), gate = new ReminderGate(), sent = [];
  const t = Date.now(), cabin = { layout: journal.start(2,1), camera: 0 };
  journal.onFreshEmpty((l, fresh) => {
    const due = gate.take(l.id, fresh, settings, cabin);
    if (due.length) sent.push(due.map(p => [p.camera,p.from-t,p.to-t]));
  });
  return { journal, cabin, sent, settings, check: (ms,token,readings) => journal.observe(journal.snapshot().active,t+ms,token,readings) };
}

test('a delay needs fresh live empty observations, not cached boxes, a repeated frame, a rename or a wall-clock timer', () => {
  const { journal, cabin, check, sent } = monitor({ enabled:true, delay:30_000 });
  check(0,1,[E,U]); check(10_000,2,[E,P]); check(25_000,3,[C,U]); check(30_000,3,[E,E]);
  journal.rename(cabin.layout,['East cabin','Lobby']); assert.deepEqual(sent,[]);
  check(30_000,4,[E,E]); check(40_000,5,[E,E]); check(60_000,6,[E,E]);
  assert.deepEqual(sent,[[[0,0,30_000]],[[1,30_000,60_000]]]);
});

test('one reminder per camera and period; cameras becoming eligible together form one batch', () => {
  const { journal, cabin, check, settings, sent } = monitor();
  check(0,1,[E,E]); assert.deepEqual(sent,[]); settings.enabled = true;
  check(800,2,[C,C]); assert.deepEqual(sent,[]); check(1000,3,[E,E]);
  settings.enabled = false; check(2000,4,[E,E]); settings.enabled = true; check(3000,5,[E,E]);
  check(4000,6,[U,P]); check(5000,7,[E,P]); check(6000,8,[E,E]);
  journal.interrupt(cabin.layout); check(7000,9,[E,U]); journal.finish(cabin.layout); check(8000,10,[E,E]);
  assert.deepEqual(sent,[[[0,0,1000],[1,0,1000]], [[0,5000,5000]], [[1,6000,6000]], [[0,7000,7000]]]);
});

test('a late frame starts a new delay; a selected cabin never follows a reused position into a new layout', () => {
  const { journal, cabin, check, sent } = monitor({ enabled:true, scope:'one', delay:30_000 });
  check(0,1,[E,E]); check(MAX_GAP+1,2,[E,E]); assert.deepEqual(sent,[]);
  check(2*MAX_GAP+1,3,[E,E]); assert.deepEqual(sent,[[[0,MAX_GAP+1,2*MAX_GAP+1]]]);
  const other=journal.start(2,1); check(100_000,1,[E,E]); check(130_000,2,[E,E]); assert.equal(sent.length,1);
  cabin.layout=other; cabin.camera=1; check(130_100,3,[E,E]); assert.deepEqual(sent.at(-1),[[1,100_000,130_100]]);
});

test('missing or corrupted reminder preferences fail closed; no cabin IDs are restored with a saved rule', () => {
  const rule={enabled:true,desktop:true,scope:'one',delay:60_000};
  for(const raw of [null, '{', '{}', JSON.stringify({...rule,scope:'whatever'}), JSON.stringify({...rule,delay:-1})]) assert.deepEqual(readPreferences(raw),DEFAULT_PREFS);
  assert.deepEqual(readPreferences(JSON.stringify({...rule,layout:'old',camera:3})),rule);
  assert.equal(readPreferences(JSON.stringify({...rule,enabled:false})).desktop,false);
});
