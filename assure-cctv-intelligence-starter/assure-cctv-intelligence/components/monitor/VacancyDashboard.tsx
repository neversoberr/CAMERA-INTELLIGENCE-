'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, Check, ChevronLeft, ChevronRight, Clock3, FolderClock, History, ListFilter, MapPin, PencilLine, Radio, Search, Timer, Trash2 } from 'lucide-react';
import { cameraLabel, endLabels, placeLabel, type Layout, type Period, type VacancyJournal } from '@/lib/monitor/vacancy';
import { Dialog } from './dialogs';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const zone = clock.resolvedOptions().timeZone;
const pageSize = 12;
function duration(ms: number) {
  const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
  return h ? `${h}h ${m}m ${sec % 60}s` : m ? `${m}m ${sec % 60}s` : `${sec}s`;
}
function Timestamp({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}><b>{clock.format(at)}</b><small>{day.format(at)}</small></time>;
}
const layoutLabel = (l: Layout) => `${day.format(l.began)}, ${clock.format(l.began)} · ${l.cols} × ${l.rows}`;
type Row = { l: Layout; p: Period };
function exportCsv(rows: Row[]) {
  // Quote all fields; also neutralise spreadsheet formulas in user-entered place names.
  const cell = (v: string) => `"${(/^[\s]*[=+@-]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;
  const lines = [['Layout ID', 'Layout started (UTC)', 'Grid', 'Camera', 'Place', 'First empty check (UTC)', 'Last empty check (UTC)', 'Duration (seconds)', 'Status'],
    ...rows.map(({ l, p }) => [l.id, new Date(l.began).toISOString(), `${l.cols}x${l.rows}`, cameraLabel(p.camera), placeLabel(l, p.camera), new Date(p.from).toISOString(), new Date(p.to).toISOString(), ((p.to - p.from) / 1000).toFixed(3), p.end ? endLabels[p.end] : 'Empty at last check'])];
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'Framewatch-vacancy.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Names({ layouts, initial, onClose, onSave }: { layouts: Layout[]; initial: Layout; onClose: () => void; onSave: (id: string, names: string[]) => void }) {
  const [id, setId] = useState(initial.id), [names, setNames] = useState(initial.names);
  const l = layouts.find(v => v.id === id);
  return <Dialog title="Name the camera places" eyebrow="LAYOUT LABELS" onClose={onClose}>
    <p className="fw-dialog-intro">Give each screen position a cabin or place name. These labels apply only to the selected layout, including its saved periods.</p>
    <label className="fw-field">Camera layout<select value={id} onChange={e => { const target = layouts.find(v => v.id === e.target.value)!; setId(target.id); setNames(target.names); }}>{layouts.map(s => <option key={s.id} value={s.id}>{layoutLabel(s)}</option>)}</select></label>
    {l && <div className="fw-name-fields">{names.map((name, i) => <label className="fw-field" key={i}>{cameraLabel(i)} · R{Math.floor(i/l.cols)+1} C{i%l.cols+1}<input maxLength={48} value={name} placeholder={cameraLabel(i)} onChange={e => setNames(names.map((v, j) => j === i ? e.target.value : v))}/></label>)}</div>}
    <div className="fw-dialog-actions"><button className="fw-btn" onClick={onClose}>Cancel</button><button className="fw-btn fw-primary" disabled={!l} onClick={() => { onSave(id, names); onClose(); }}><Check size={15}/>Save names</button></div>
  </Dialog>;
}

export function VacancyDashboard({ journal, sharing }: { journal: VacancyJournal; sharing: boolean }) {
  const { layouts, active, temporary } = useSyncExternalStore(journal.subscribe, journal.snapshot, journal.snapshot);
  const [selected, setSelected] = useState(''), [search, setSearch] = useState(''), [date, setDate] = useState('');
  const [page, setPage] = useState(0), [edit, setEdit] = useState(false), [confirmClear, setConfirmClear] = useState(false), [clearFailed, setClearFailed] = useState(false);
  const picked = layouts.find(l => l.id === selected), current = layouts.find(l => l.id === active);
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const first = new Date(`${date}T00:00:00`), after = new Date(first); after.setDate(first.getDate() + 1);
    return (picked ? [picked] : layouts).flatMap(l => l.periods.filter(p =>
      (!term || `${cameraLabel(p.camera)} ${placeLabel(l,p.camera)}`.toLocaleLowerCase().includes(term)) &&
      (!date || p.to >= first.getTime() && p.from < after.getTime())
    ).map(p => ({ l, p }))).sort((a, b) => b.p.to - a.p.to || b.p.from - a.p.from || a.p.camera - b.p.camera);
  }, [layouts, picked, date, search]);
  useEffect(() => setPage(0), [selected, search, date]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), visible = Math.min(page, pages - 1);
  const total = rows.reduce((sum, r) => sum + r.p.to - r.p.from, 0), longest = rows.reduce((max, r) => Math.max(max, r.p.to - r.p.from), 0);
  const naming = picked || current || layouts[0];
  const filtered = !!(picked || search || date);
  return <section className="fw-history" aria-label="Vacancy history">
    <div className="fw-history-summary">
      <div><History/><dl><dt>Empty periods</dt><dd>{rows.length}</dd></dl></div>
      <div><Clock3/><dl><dt>Total empty camera-time</dt><dd>{duration(total)}</dd></dl></div>
      <div><Timer/><dl><dt>Longest empty period</dt><dd>{rows.length ? duration(longest) : '—'}</dd></dl></div>
    </div>
    <section className="fw-panel fw-log" aria-label="Observed empty periods">
      <div className="fw-log-head"><div><div className="fw-eyebrow"><i className={`fw-history-dot ${sharing ? 'live' : ''}`}/>{sharing ? 'SCREEN CONNECTED' : 'HISTORY ONLY'}</div><h2>Empty periods by place</h2></div>
        <div className="fw-log-actions"><button className="fw-btn" disabled={!naming} onClick={() => setEdit(true)}><PencilLine size={14}/>Name places</button>
          <button className="fw-btn" disabled={!rows.length} onClick={() => exportCsv(rows)}><ArrowDownToLine size={15}/>Export CSV</button></div></div>
      <div className="fw-log-filters"><label className="fw-field"><span><ListFilter size={13}/>Camera layout</span><select value={picked?.id || ''} onChange={e => setSelected(e.target.value)}><option value="">All layouts</option>{layouts.map(l => <option key={l.id} value={l.id}>{l.id === active ? 'Current · ' : ''}{layoutLabel(l)}</option>)}</select></label>
        <label className="fw-field"><span><Search size={13}/>Find a place</span><input type="search" value={search} placeholder="Cabin name or camera number" onChange={e => setSearch(e.target.value)}/></label>
        <label className="fw-field"><span>Observed on</span><input type="date" value={date} onChange={e => setDate(e.target.value)}/></label></div>
      {rows.length ? <div className="fw-table-scroll" tabIndex={0} role="region" aria-label="Empty period table"><table className="fw-log-table"><thead><tr><th>Cabin / place</th><th>Empty from</th><th>Last seen empty</th><th>Duration</th><th>Period status</th></tr></thead>
        <tbody>{rows.slice(visible * pageSize, (visible + 1) * pageSize).map(({ l, p }, i) => <tr key={`${l.id}/${p.camera}/${p.from}/${i}`}>
          <td><b>{placeLabel(l,p.camera)}</b><small title={`Layout started ${layoutLabel(l)}`}>{l.names[p.camera] ? cameraLabel(p.camera) + ' · ' : ''}{l.cols}×{l.rows} layout · {clock.format(l.began)}</small></td>
          <td><Timestamp at={p.from}/></td><td><Timestamp at={p.to}/></td><td>{p.to === p.from ? <span title="Only one empty observation; zero measured duration">Single check</span> : duration(p.to - p.from)}</td>
          <td><span className={`fw-period-status ${p.end ? '' : 'latest'}`}>{p.end ? endLabels[p.end] : 'Empty at last check'}</span></td></tr>)}</tbody></table></div>
        : <div className="fw-log-empty">{filtered ? <Search size={28}/> : <FolderClock size={30}/>}<h3>{filtered ? 'No matching empty periods' : 'No empty periods observed yet'}</h3>
          <p>{filtered ? 'Try another date, place or camera layout.' : sharing ? 'The first empty observation from a usable live camera will appear here.' : 'Share your CCTV window and match the camera grid to begin. Samples and screenshots never add history.'}</p>
          {filtered && <button className="fw-text-btn" onClick={() => { setSelected(''); setSearch(''); setDate(''); }}>Reset filters</button>}</div>}
      <div className="fw-log-foot"><span>Local time · {zone}</span>{pages > 1 && <div><button className="fw-icon-btn" aria-label="Previous periods" disabled={visible === 0} onClick={() => setPage(visible - 1)}><ChevronLeft size={15}/></button>{visible + 1} / {pages}<button className="fw-icon-btn" aria-label="Next periods" disabled={visible + 1 >= pages} onClick={() => setPage(visible + 1)}><ChevronRight size={15}/></button></div>}</div>
    </section>
    <div className="fw-history-note"><Radio size={17}/><p><strong>Reading a period.</strong> From and until are the first and last live checks with no person detected, not exact departure or arrival times. Unclear views and gaps break the period. Total camera-time adds each camera separately.</p></div>
    <div className="fw-history-note"><MapPin size={17}/><p><strong>{temporary ? 'Browser storage unavailable.' : 'Saved on this browser.'}</strong> {temporary ? 'New history may only last for this tab. Export CSV before closing.' : 'Only layout labels, observation times and period status are saved. On opening, history is trimmed to the last 30 days. Up to 20 layouts and 500 periods per layout are kept.'} {sharing ? 'Stop sharing before clearing history.' : ''}</p>
      <button className="fw-text-btn" disabled={sharing || !layouts.length} onClick={() => setConfirmClear(true)}><Trash2 size={14}/>Clear history</button></div>
    {clearFailed && <p className="fw-notice" role="alert">Browser settings prevented deletion of some entries. Clear this site’s browser data to remove them.</p>}
    {edit && naming && <Names layouts={layouts} initial={naming} onClose={() => setEdit(false)} onSave={(id,names) => journal.rename(id,names)}/>}
    {confirmClear && <Dialog title="Clear vacancy history?" eyebrow="LOCAL HISTORY" onClose={() => setConfirmClear(false)}><p className="fw-dialog-intro">This removes saved places and empty periods from this browser. Export any periods you want to keep first.</p>
      <div className="fw-dialog-actions"><button className="fw-btn" onClick={() => setConfirmClear(false)}>Cancel</button><button className="fw-btn fw-stop" onClick={() => { setClearFailed(!journal.clear()); setSelected(''); setSearch(''); setDate(''); setConfirmClear(false); }}>Delete saved history</button></div></Dialog>}
  </section>;
}
