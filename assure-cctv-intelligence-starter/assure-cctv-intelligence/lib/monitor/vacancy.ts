// Browser-local observation journal. A layout is one uninterrupted mapping of
// screen positions to places. Nothing here accepts images, boxes or identities.
export const PREFIX = 'framewatch.vacancy.v1.';
export const MAX_GAP = 30_000;
const KEEP_MS = 30 * 86_400_000, MAX_LAYOUTS = 20, MAX_PERIODS = 500;
export const endLabels = {
  occupied: 'Person detected', unclear: 'Unclear view', gap: 'Gap in checks', stopped: 'Monitoring ended', archived: 'Last saved check',
} as const;
type End = keyof typeof endLabels;
export type Period = { camera: number; from: number; to: number; end: End | null };
export type Layout = { id: string; began: number; cols: number; rows: number; names: string[]; periods: Period[] };
export type JournalView = { layouts: Layout[]; active: string | null; temporary: boolean };
type Evidence = { state: string; cached?: boolean };
const dimension = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 4;
const timestamp = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) < 8.64e15;
const cleanName = (s: unknown) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 48) : '';
export const cameraLabel = (i: number) => `Camera ${String(i + 1).padStart(2, '0')}`;
export const placeLabel = (l: Layout, i: number) => l.names[i] || cameraLabel(i);
const latest = (l: Layout) => l.periods.reduce((t, p) => Math.max(t, p.to), l.began);

function prune(periods: Period[], now: number) {
  const recent = periods.filter(p => p.to >= now - KEEP_MS);
  // A long-running interval must not fall out because another camera changes frequently.
  if (recent.length > MAX_PERIODS) recent.sort((a, b) => Number(b.end === null) - Number(a.end === null) || b.to - a.to).length = MAX_PERIODS;
  return recent;
}

function restore(id: string, l: ReturnType<typeof JSON.parse>, now: number): Layout | null {
  if (!l || !timestamp(l.began) || !dimension(l.cols) || !dimension(l.rows) || !Array.isArray(l.periods)) return null;
  const count = l.cols * l.rows;
  const periods: Period[] = [];
  for (const p of l.periods) {
    if (!p || !Number.isInteger(p.camera) || p.camera < 0 || p.camera >= count || !timestamp(p.from) || !timestamp(p.to) || p.from > p.to) continue;
    if (p.end !== null && !Object.prototype.hasOwnProperty.call(endLabels, p.end)) continue;
    // A closed tab / crash cannot assert that any place remained empty.
    periods.push({ camera: p.camera, from: p.from, to: p.to, end: p.end ?? 'archived' });
  }
  const layout = { id, began: l.began, cols: l.cols, rows: l.rows, names: Array.from({ length: count }, (_, i) => cleanName(l.names?.[i])), periods: prune(periods, now) };
  return latest(layout) >= now - KEEP_MS ? layout : null;
}

export class VacancyJournal {
  private view: JournalView = { layouts: [], active: null, temporary: false };
  private listeners = new Set<() => void>();
  private disk: Storage | null = null;
  private token = -1;
  private previousAt = 0;
  private written = 0;
  snapshot = () => this.view;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(update: Partial<JournalView>) {
    this.view = { ...this.view, ...update };
    this.listeners.forEach(fn => fn());
  }
  private unavailable() { if (!this.view.temporary) this.publish({ temporary: true }); }
  private save(l: Layout) {
    if (!this.disk) return;
    this.written = Date.now();
    try { this.disk.setItem(PREFIX + l.id, JSON.stringify(l)); }
    catch { this.unavailable(); }
  }
  private remove(id: string) {
    try { this.disk?.removeItem(PREFIX + id); return true; } catch { this.unavailable(); return false; }
  }
  // One key per layout: a second monitoring tab does not overwrite the first one's log.
  attach(disk: Storage | null) {
    this.disk = disk;
    if (!disk) { this.unavailable(); return; }
    const now = Date.now(), layouts: Layout[] = [];
    try {
      const keys = Array.from({ length: disk.length }, (_, i) => disk.key(i)).filter((k): k is string => !!k?.startsWith(PREFIX));
      for (const k of keys) {
        const id = k.slice(PREFIX.length);
        const raw = disk.getItem(k); let parsed, l: Layout | null = null;
        try { parsed = JSON.parse(raw || 'null'); l = restore(id, parsed, now); } catch { /* Ignore malformed local entries. */ }
        if (l) {
          layouts.push(l);
          // Purge expired periods even when a newer period keeps this layout alive.
          if (l.periods.length < parsed.periods.length) this.save(l);
        } else this.remove(id);
      }
      layouts.sort((a, b) => latest(b) - latest(a));
      for (const old of layouts.splice(MAX_LAYOUTS)) this.remove(old.id);
      this.publish({ layouts });
    } catch { this.unavailable(); }
  }
  private replace(l: Layout) {
    this.publish({ layouts: this.view.layouts.map(old => old.id === l.id ? l : old) });
  }
  private current(id: string) { return id === this.view.active ? this.view.layouts.find(l => l.id === id) : undefined; }
  start(cols: number, rows: number) {
    if (this.view.active) this.finish(this.view.active);
    const now = Date.now(), id = crypto.randomUUID();
    const l: Layout = { id, began: now, cols, rows, names: Array(cols * rows).fill(''), periods: [] };
    const layouts = [l, ...this.view.layouts.filter(old => latest(old) >= now - KEEP_MS)].slice(0, MAX_LAYOUTS);
    for (const old of this.view.layouts) if (!layouts.includes(old)) this.remove(old.id);
    this.token = -1; this.previousAt = 0; this.written = 0;
    this.publish({ active: id, layouts }); this.save(l); return id;
  }
  observe(id: string, at: number, token: number, readings: Evidence[]) {
    const l = this.current(id);
    if (!l || !timestamp(at) || !Number.isFinite(token) || token <= this.token || readings.length !== l.cols * l.rows) return;
    this.token = token;
    const discontinuity = this.previousAt > 0 && (at <= this.previousAt || at - this.previousAt > MAX_GAP);
    this.previousAt = at;
    const open = new Set<number>(); let changed = false, boundary = false;
    const periods = l.periods.map(p => {
      if (p.end !== null) return p;
      const r = readings[p.camera];
      const end = discontinuity || at - p.to > MAX_GAP ? 'gap' : r.state === 'occupied' ? 'occupied' : r.state !== 'empty' ? 'unclear' : null;
      if (end) { changed = boundary = true; return { ...p, end } as Period; }
      open.add(p.camera);
      if (r.cached) return p; // no new inference for this place
      changed = true; return { ...p, to: at };
    });
    readings.forEach((r, camera) => {
      if (r.state === 'empty' && !r.cached && !open.has(camera)) {
        periods.push({ camera, from: at, to: at, end: null }); changed = boundary = true;
      }
    });
    if (!changed) return;
    const next = { ...l, periods: prune(periods, Date.now()) };
    this.replace(next);
    if (boundary || Date.now() - this.written >= 4000) this.save(next);
  }
  interrupt(id: string, end: End = 'gap') {
    const l = this.current(id); if (!l || !l.periods.some(p => p.end === null)) return;
    const next = { ...l, periods: l.periods.map(p => p.end === null ? { ...p, end } : p) };
    this.replace(next); this.save(next);
  }
  finish(id: string) {
    if (id !== this.view.active) return;
    this.interrupt(id, 'stopped'); this.publish({ active: null });
  }
  rename(id: string, names: string[]) {
    const l = this.view.layouts.find(s => s.id === id); if (!l) return;
    const next = { ...l, names: l.names.map((_, i) => cleanName(names[i])) }; this.replace(next); this.save(next);
  }
  clear() {
    if (this.view.active) return false;
    // Never call localStorage.clear(): other applications may share the origin.
    const failed = this.view.layouts.filter(l => !this.remove(l.id));
    this.publish({ layouts: failed }); return !failed.length;
  }
}
