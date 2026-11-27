import type { Period } from './vacancy';

export const PREFS_KEY = 'framewatch.reminders.v1';
export const DELAYS = [
  [0, 'On the first empty check'], [30_000, 'After 30 seconds'], [60_000, 'After 1 minute'],
  [300_000, 'After 5 minutes'], [900_000, 'After 15 minutes'],
] as const;
export type Preferences = { enabled: boolean; desktop: boolean; delay: number; scope: 'all' | 'one' };
export const DEFAULT_PREFS: Preferences = { enabled: false, desktop: false, delay: 0, scope: 'all' };
export type Cabin = { layout: string; camera: number };

// Only remember the rule, not which screen position was called "Cabin A".
// A single-place rule must be assigned again when a different layout is shared.
export function readPreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw || 'null');
    if (p && typeof p.enabled === 'boolean' && typeof p.desktop === 'boolean' &&
        DELAYS.some(([n]) => n === p.delay) && (p.scope === 'all' || p.scope === 'one')) {
      return { enabled: p.enabled, desktop: p.enabled && p.desktop, delay: p.delay, scope: p.scope };
    }
  } catch { /* Damaged settings must not silently enable an alert. */ }
  return { ...DEFAULT_PREFS };
}

// Driven only by VacancyJournal.onFreshEmpty. Check observation timestamps, not
// Date.now() or a background timer. Memory is bounded to one entry per camera.
export class ReminderGate {
  private layout = '';
  private delivered = new Map<number, number>();
  take(id: string, fresh: readonly Period[], prefs: Preferences, cabin: Cabin | null) {
    if (id !== this.layout) { this.layout = id; this.delivered.clear(); }
    if (!prefs.enabled) return [];
    return fresh.filter(p => {
      if (p.end !== null || p.to - p.from < prefs.delay || this.delivered.get(p.camera) === p.from) return false;
      if (prefs.scope === 'one' && (cabin?.layout !== id || cabin.camera !== p.camera)) return false;
      this.delivered.set(p.camera, p.from); return true;
    }).sort((a, b) => a.camera - b.camera);
  }
}
