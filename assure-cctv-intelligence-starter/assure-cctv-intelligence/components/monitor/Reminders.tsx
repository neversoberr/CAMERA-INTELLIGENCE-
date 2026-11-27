'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { ArrowRight, Bell, BellRing, Clock3, Monitor as Screen, X } from 'lucide-react';
import { DELAYS } from '@/lib/monitor/reminders';
import { cameraLabel, type VacancyJournal } from '@/lib/monitor/vacancy';
import { useReminders } from './use-reminders';

type Controls = ReturnType<typeof useReminders>;
function ReminderSettings({ journal, r }: { journal: VacancyJournal; r: Controls }) {
  const { active, layouts } = useSyncExternalStore(journal.subscribe, journal.snapshot, journal.snapshot);
  const layout = layouts.find(l => l.id === active);
  const { prefs, cabin, permission, refreshPermission } = r;
  useEffect(refreshPermission, [refreshPermission]);
  const selected = prefs.scope === 'all' ? 'all' : cabin && cabin.layout === active ? String(cabin.camera) : '';
  const armed = prefs.enabled && !!layout && selected !== '';
  const status = !prefs.enabled ? 'Off · No reminders will be sent' : !layout ? 'Ready · Waiting for a live screen share'
    : !selected ? 'Paused · Choose a place in this layout' : `On · Watching ${selected === 'all' ? 'all live cameras' : layout.names[Number(selected)] || cameraLabel(Number(selected))}`;
  const blocked = permission === 'denied' || permission === 'unavailable';
  const desktopStatus = permission === 'denied' ? 'Blocked by browser' : permission === 'unavailable' ? 'Not available here'
    : prefs.desktop && permission === 'granted' ? 'On for this PC' : 'Off';
  return <section className="fw-reminder-grid" aria-label="Reminder settings">
    <section className="fw-panel fw-reminder-card">
      <div className="fw-rule-head"><div className="fw-heading-group"><BellRing size={19}/><h2>Live vacancy reminders</h2></div>
        <button className="fw-rule-switch" role="switch" aria-label="Empty-cabin reminders" aria-checked={prefs.enabled} onClick={() => r.enable(!prefs.enabled)}><i/>{prefs.enabled ? 'On' : 'Off'}</button></div>
      <p>Notify me once per empty period in each selected place. The delay counts observed empty time, not time since the last frame.</p>
      <div className="fw-rule-fields">
        <label className="fw-field">Remind me<select value={prefs.delay} onChange={e => r.delay(Number(e.target.value))}>{DELAYS.map(([n,label]) => <option key={n} value={n}>{label}</option>)}</select></label>
        <label className="fw-field">Camera or place<select value={selected} onChange={e => { const v = e.target.value; if (v === 'all') r.choose(null); else if (layout) r.choose({ layout: layout.id, camera: Number(v) }); }}>
          {selected === '' && <option value="" disabled>Choose a place again</option>}<option value="all">All live cameras</option>
          {layout?.names.map((name,i) => <option key={i} value={i}>{name ? `${name} · ${cameraLabel(i)}` : cameraLabel(i)}</option>)}
        </select></label>
      </div>
      <p>{layout ? 'A single-place rule pauses if you change the layout or reconnect. Choose the place again to resume.' : 'Share your CCTV grid to choose an individual cabin. Samples and screenshots never trigger reminders.'}</p>
      <div className={`fw-rule-status ${armed ? 'armed' : ''}`}><i/>{status}</div>
    </section>
    <section className="fw-panel fw-reminder-card">
      <div className="fw-rule-head"><div className="fw-heading-group"><Screen size={19}/><h2>Desktop notifications</h2></div><span className="fw-period-status">{desktopStatus}</span></div>
      <p>Also show the place name and check time in a notification on this PC. These details may appear on your lock screen.</p>
      <div className="fw-rule-actions">
        {prefs.desktop ? <button className="fw-btn" onClick={r.desktopOff}>Turn off desktop notifications</button> :
          <button className="fw-btn" disabled={!prefs.enabled || blocked || r.requesting} onClick={r.desktopOn}><Bell size={14}/>{r.requesting ? 'Awaiting permission…' : 'Enable desktop notifications'}</button>}
        {prefs.desktop && permission === 'granted' && <button className="fw-btn" onClick={r.testDesktop}>Test notification</button>}
      </div>
      <p>{permission === 'denied' ? 'Check notification permissions in your browser or use in-app reminders. Framewatch will not ask again automatically.'
        : permission === 'unavailable' ? 'This browser or window cannot show desktop notifications. In-app reminders still work.'
        : !prefs.enabled ? 'Turn on live vacancy reminders first. Browser permission is requested only if you enable desktop notifications.'
        : prefs.desktop ? 'If banners do not appear, check the browser’s notification settings and Do Not Disturb on your PC.'
        : 'In-app alerts are on. Desktop delivery is optional and requires browser permission.'}</p>
      {r.issue && <p className="fw-reminder-hint" role="status">{r.issue}</p>}
    </section>
    <div className="fw-history-note fw-reminder-help"><Clock3 size={16}/><p><strong>Only while monitoring.</strong> Keep this tab open and your camera screen shared. Occupied, unclear and interrupted views end the empty period. No messages are sent to a server or phone.</p></div>
    {r.temporary && <p className="fw-notice" role="status">Browser storage is unavailable. These preferences apply in this tab only.</p>}
  </section>;
}

// Mounted in the same place for every view, including while settings are hidden.
export function Reminders({ journal, visible }: { journal: VacancyJournal; visible: boolean }) {
  const r = useReminders(journal), alert = r.batch;
  return <>
    {visible && <ReminderSettings journal={journal} r={r}/>}
    {alert && <aside className="fw-reminder-toast" aria-label="Vacancy reminder">
      <div className="fw-toast-head"><span className="fw-eyebrow"><BellRing size={15}/> VACANCY REMINDER</span><button className="fw-icon-btn" onClick={r.dismiss} aria-label="Dismiss reminder"><X size={16}/></button></div>
      <div role="status" aria-atomic="true"><strong>{alert.title}</strong><p>{alert.body}</p></div>
      {alert.places.length > 3 && <details><summary>Show all {alert.places.length} places</summary><p>{alert.places.map(p => p.name).join(', ')}</p></details>}
      <a href="#vacancy" onClick={r.dismiss}>Review vacancy periods <ArrowRight size={13}/></a>
    </aside>}
  </>;
}
