'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PREFS, PREFS_KEY, readPreferences, ReminderGate, type Cabin, type Preferences } from '@/lib/monitor/reminders';
import { placeLabel, type VacancyJournal } from '@/lib/monitor/vacancy';

type Permission = NotificationPermission | 'unavailable';
function desktopPermission(): Permission {
  try {
    return window.isSecureContext && typeof window.Notification === 'function' && typeof Notification.requestPermission === 'function'
      ? Notification.permission : 'unavailable';
  } catch { return 'unavailable'; }
}
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
type Batch = { layout: string; title: string; body: string; places: { camera: number; from: number; name: string }[] };

export function useReminders(journal: VacancyJournal) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS), rule = useRef(prefs);
  const [cabin, setCabin] = useState<Cabin | null>(null), target = useRef(cabin);
  const [permission, setPermission] = useState<Permission>('unavailable');
  const [temporary, setTemporary] = useState(false), [requesting, setRequesting] = useState(false);
  const [issue, setIssue] = useState(''), [batch, setBatch] = useState<Batch | null>(null);
  const latest = useRef<Batch | null>(null), native = useRef<Notification | null>(null), ticket = useRef(0);
  const [gate] = useState(() => new ReminderGate());

  const write = (patch: Partial<Preferences>) => {
    const next = { ...rule.current, ...patch }; rule.current = next; setPrefs(next);
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); setTemporary(false); }
    catch { setTemporary(true); } // A file-origin/private tab still works in memory.
  };
  const closeDesktop = useCallback(() => {
    const n = native.current; native.current = null;
    if (n) {
      try { n.onclose = n.onclick = n.onerror = null; n.close(); }
      catch { /* Revoked OS/browser access must not interrupt the next live sweep. */ }
    }
  }, []);
  const dismiss = useCallback(() => { latest.current = null; setBatch(null); closeDesktop(); }, [closeDesktop]);
  const refreshPermission = useCallback(() => setPermission(desktopPermission()), []);
  const showDesktop = useCallback((title: string, body: string, tag: string, review: boolean) => {
    // Browser permission by itself is not app opt-in. Never request it here.
    if (!rule.current.enabled || !rule.current.desktop) return;
    const allowed = desktopPermission(); setPermission(allowed);
    if (allowed !== 'granted') { setIssue('Desktop permission is not available. Reminders will appear in Framewatch.'); return; }
    closeDesktop();
    const failed = () => setIssue('The browser could not show a desktop notification. In-app reminders are still on.');
    try {
      const n = new Notification(`Framewatch · ${title}`, { body, tag }); native.current = n;
      n.onerror = failed;
      n.onclose = () => { if (native.current === n) native.current = null; };
      n.onclick = () => { window.focus(); if (review) window.location.hash = 'vacancy'; n.close(); };
    } catch { failed(); }
  }, [closeDesktop]);

  useEffect(() => {
    try { rule.current = readPreferences(window.localStorage.getItem(PREFS_KEY)); setPrefs(rule.current); }
    catch { setTemporary(true); }
    refreshPermission();
    window.addEventListener('focus', refreshPermission);
    const offChecks = journal.onFreshEmpty((layout, fresh) => {
      const due = gate.take(layout.id, fresh, rule.current, target.current);
      if (!due.length) return;
      const places = due.map(p => ({ camera: p.camera, from: p.from, name: placeLabel(layout, p.camera) }));
      const { from, to } = due[0];
      const title = places.length === 1 ? `${places[0].name} observed empty` : `${places.length} places observed empty`;
      const names = places.slice(0, 3).map(p => p.name).join(', ') + (places.length > 3 ? ` +${places.length - 3} more` : '');
      const body = places.length > 1 ? `${names}. No person detected at ${time(to)}.` : from === to
        ? `No person detected at ${time(to)}.` : `No person detected in checks from ${time(from)} to ${time(to)}.`;
      const alert = { layout: layout.id, title, body, places }; latest.current = alert; setBatch(alert);
      showDesktop(title, body, `framewatch-vacancy-${layout.id}`, true);
    });
    // Discard an on-screen alert that no longer describes this live layout/period.
    // Snapshot changes may dismiss a reminder, but can never issue one.
    const offChanges = journal.subscribe(() => {
      const alert = latest.current; if (!alert) return;
      const { active, layouts } = journal.snapshot();
      const layout = active === alert.layout && layouts.find(l => l.id === active);
      if (!layout || !alert.places.every(place => layout.periods.some(p => p.end === null && p.camera === place.camera && p.from === place.from))) dismiss();
    });
    const onLeave = () => { ticket.current++; setRequesting(false); dismiss(); };
    window.addEventListener('pagehide', onLeave);
    return () => {
      offChecks(); offChanges(); ticket.current++; closeDesktop();
      window.removeEventListener('focus', refreshPermission); window.removeEventListener('pagehide', onLeave);
    };
  }, [journal, gate, dismiss, closeDesktop, showDesktop, refreshPermission]);

  function enable(value: boolean) {
    ticket.current++; setRequesting(false); setIssue(''); dismiss();
    write({ enabled: value, desktop: false });
  }
  function choose(value: Cabin | null) {
    dismiss(); target.current = value; setCabin(value); write({ scope: value ? 'one' : 'all' });
  }
  function desktopOff() {
    ticket.current++; setRequesting(false); closeDesktop(); setIssue(''); write({ desktop: false });
  }
  // Called only by the separate desktop opt-in button, within a user gesture.
  async function desktopOn() {
    if (!rule.current.enabled) return;
    const id = ++ticket.current; setRequesting(true); setIssue('');
    try {
      const before = desktopPermission();
      const after = before === 'default' ? await Notification.requestPermission() : before;
      if (id !== ticket.current) return;
      setPermission(after); write({ desktop: after === 'granted' });
      if (after === 'default') setIssue('Permission was not granted. You can keep using in-app reminders.');
    } catch {
      if (id === ticket.current) { refreshPermission(); setIssue('This window could not request desktop permission. In-app reminders still work.'); }
    } finally { if (id === ticket.current) setRequesting(false); }
  }
  return { prefs, cabin, permission, temporary, requesting, issue, batch, dismiss, enable, choose, desktopOn, desktopOff, refreshPermission,
    delay: (delay: number) => { dismiss(); write({ delay }); },
    testDesktop: () => { setIssue(''); showDesktop('Test notification', 'Desktop reminders are enabled. This is a test, not a camera observation.', 'framewatch-test', false); },
  };
}
