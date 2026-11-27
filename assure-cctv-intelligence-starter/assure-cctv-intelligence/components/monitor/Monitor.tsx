'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity, ArrowRight, Clock3, Download, BookOpen, Cctv, ChevronDown,
  CircleDashed, Crop, Expand, Grid2X2, Image as ImageIcon, Info, Layers2,
  LoaderCircle, LockKeyhole, Monitor as MonitorIcon, MonitorUp, Radio, Scan, ScanLine, SlidersHorizontal,
  ShieldCheck, Square, Upload, UsersRound, X,
} from 'lucide-react';
import '@fontsource-variable/manrope';
import './monitor.css';
import {
  DEFAULT_GRID, FULL, isFull, isSampleLayout, PROFILES, SAMPLE_NAMES, sourceName, stateLabel, twoDigits,
  type DetectionMode, type Grid, type Reading, type Rect, type ScanStats, type Source, type State,
} from '@/lib/monitor/types';
import { HOME_URL, PC_DOWNLOAD, SAMPLE_URL } from '@/lib/monitor/platform';
import { CropDialog, Guide } from './dialogs';
import { useSource } from './use-source';
import { useAnalysis } from './use-analysis';
import { CaptureRateControl } from './CaptureRateControl';
import { useLivePreview } from './use-live-preview';
import { VacancyJournal } from '@/lib/monitor/vacancy';
import { VacancyDashboard } from './VacancyDashboard';
import { Reminders } from './Reminders';

const VIEWS = {
  monitor: { tab: 'Monitor', eyebrow: 'VISION WORKSPACE', title: 'Occupancy monitor', intro: 'Share your CCTV screen or open an image to see which camera views are occupied.' },
  vacancy: { tab: 'Vacancy dashboard', eyebrow: 'OBSERVATION HISTORY', title: 'Vacancy dashboard', intro: 'See when each cabin or place was observed empty during live monitoring.' },
  reminders: { tab: 'Reminders', eyebrow: 'LOCAL NOTIFICATIONS', title: 'Empty-cabin reminders', intro: 'Choose when and where to be notified that no person was detected in a cabin.' },
} as const;
type View = keyof typeof VIEWS;
type Icon = typeof Cctv;
type Filter = 'all' | Exclude<State, 'checking'>;
const defaults = ['1x1', '2x2', '3x3', '4x4'];
const otherLayouts = Array.from({ length: 16 }, (_, i) => `${i % 4 + 1}x${Math.floor(i / 4) + 1}`).filter(s => !defaults.includes(s));

function BrandMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'fw-mark-small' : 'fw-mark'} width="34" height="34" viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="currentColor"/><path d="M8 15V9h8m12 12v6h-8" stroke="#142015" strokeWidth="2.8" strokeLinecap="square"/>
    <path d="M10 21.5 18 12l8 2.5L18 24z" fill="#142015"/><circle cx="18" cy="18" r="2.4" fill="currentColor"/>
  </svg>;
}

function Stats({ readings }: { readings: Reading[] }) {
  const checking = readings.some(r => r.state === 'checking');
  const cards: [string, string, Icon, number][] = [
    ['total', 'Camera views', Cctv, readings.length],
    ['occupied', 'Occupied', UsersRound, readings.filter(r => r.state === 'occupied').length],
    ['empty', 'Empty', Scan, readings.filter(r => r.state === 'empty').length],
    ['unclear', 'Unclear', CircleDashed, readings.filter(r => r.state === 'unclear').length],
  ];
  return <dl className="fw-stats" aria-label="Occupancy summary">{cards.map(([kind, label, Glyph, count]) =>
    <div className={`fw-stat ${kind}`} key={kind}>
      <div className="fw-stat-glyph"><Glyph size={24} strokeWidth={1.6}/></div><div><dt>{label}</dt><dd>{checking && kind !== 'total' ? '—' : twoDigits(count)}</dd></div>
      <span className="fw-stat-line" aria-hidden="true"/>
    </div>)}
  </dl>;
}

function GridControl({ grid, onChange }: { grid: Grid; onChange: (g: Grid) => void }) {
  const options = (values: string[]) => values.map(value => <option key={value} value={value}>{value.replace('x', ' × ')}</option>);
  return <label className="fw-grid-select" title="Camera grid: columns × rows"><Grid2X2 size={14}/>
    <select aria-label="Camera grid: columns by rows" value={`${grid.cols}x${grid.rows}`} onChange={e => {
      const [cols, rows] = e.target.value.split('x').map(Number); onChange({ cols, rows });
    }}><optgroup label="Square grids (columns × rows)">{options(defaults)}</optgroup><optgroup label="Rectangular grids (columns × rows)">{options(otherLayouts)}</optgroup></select>
    <ChevronDown size={12}/></label>;
}

function Status({ state, title }: { state: State; title?: string }) {
  return <span className={`fw-status ${state}`} title={title}><i/>{stateLabel[state]}</span>;
}

function CameraWall({ source, grid, setGrid, crop, onCrop, analysis, onCloseSource }: {
  source: Source; grid: Grid; setGrid: (g: Grid) => void; crop: Rect; onCrop: () => void;
  analysis: ReturnType<typeof useAnalysis>; onCloseSource: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [display, setDisplay] = useState<'live' | 'scan'>('live');
  const preview = useLivePreview(source, crop);
  const screen = source.kind === 'screen', moving = screen && display === 'live';
  const expandBtn = useRef<HTMLButtonElement>(null);
  // Expanded view also works in embedded previews that disallow the Fullscreen API.
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const keys = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { setExpanded(false); expandBtn.current?.focus(); }
      if (e.key === 'Tab') {
        const buttons = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select');
        if (!buttons?.length) return;
        if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', keys); };
  }, [expanded]);
  const { phase, readings, checkedAt } = analysis;
  const ratio = moving && preview.viewport ? preview.viewport.ratio : analysis.ratio;
  const wait = moving ? (!preview.receiving ? 'Waiting for live video frames' : null) :
    phase === 'no-frame' ? 'Waiting for a visible camera frame' : screen && phase !== 'ready'
      ? (phase === 'error' ? 'No checked frame available' : 'Waiting for a checked frame…') : null;
  const sourceLabel = source.kind === 'demo' ? 'Sample' : source.kind === 'image' ? 'Screenshot' : 'Screen share';
  return <section ref={panel} className={`fw-panel fw-wall ${expanded ? 'fw-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label="Camera wall">
    <div className="fw-panel-head"><div className="fw-heading-group"><MonitorIcon size={18}/><h2>Camera wall</h2><span className={`fw-source-tag ${source.kind}`}><i/>{sourceLabel}</span></div>
      <div className="fw-tools"><GridControl grid={grid} onChange={setGrid}/><span className="fw-tool-sep"/>
        <button className={`fw-icon-btn ${!isFull(crop) ? 'selected' : ''}`} onClick={onCrop} aria-label="Crop to camera grid" title="Crop to camera grid"><Crop size={16}/></button>
        <button ref={expandBtn} className="fw-icon-btn" aria-label={expanded ? 'Close expanded view' : 'Expand camera wall'} title={expanded ? 'Close expanded view' : 'Expand camera wall'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={17}/> : <Expand size={16}/>}</button>
      </div>
    </div>
    {screen && <div className="fw-playback-bar"><div className="fw-filters" role="group" aria-label="Camera wall display">
      <button aria-pressed={moving} onClick={() => setDisplay('live')} title="Play the shared window without waiting for detection"><Radio size={13}/>Live video</button>
      <button aria-pressed={!moving} onClick={() => setDisplay('scan')} title="Show the checked still with boxes from fresh detections"><ScanLine size={13}/>Last scan</button>
    </div><CaptureRateControl track={source.stream.getVideoTracks()[0]}/><span className="fw-playback-meter" title="Measured incoming shared-window frames per second, not the analysis rate"><i/>{!preview.receiving ? 'Waiting for video' : preview.fps === null ? 'Measuring input…' : `Input ~${preview.fps} fps`}</span></div>}
    <div className="fw-stage-surround"><div className={`fw-stage ${grid.cols > 2 || grid.rows > 2 ? 'fw-dense' : ''}`} style={{ aspectRatio: ratio, width: expanded ? `min(100%, ${ratio * 100}cqh)` : `min(100%, ${ratio * 66}svh)` }}>
      {screen && <div ref={preview.host} className="fw-live-feed" aria-hidden={!moving} style={{ ...preview.viewport?.style, visibility: moving && preview.viewport ? 'visible' : 'hidden' }}/>}
      {phase === 'sample' ? <img className="fw-frame" src={SAMPLE_URL} alt="Sample camera wall: reception, meeting room, workspace, and corridor"/> : <canvas className="fw-frame" hidden={moving || (screen && phase !== 'ready')} ref={analysis.canvasRef} aria-label={screen ? 'Last checked camera frame' : 'Latest captured frame'}/>}
      <div className="fw-tile-grid" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0,1fr))` }}>
        {readings.map((reading, i) => <div key={i} className={`fw-tile ${reading.state}`}>
          <span className="fw-camera-tag"><i/>CAM {twoDigits(i + 1)}</span>
          {!moving && !reading.cached && reading.boxes.map((b, j) => <div aria-hidden="true" className="fw-person-box" key={j} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}><i/><i/><i/><i/></div>)}
          <span className="fw-tile-caption"><i/>{moving && reading.state !== 'checking' ? 'Last check: ' : ''}{stateLabel[reading.state]}</span>
        </div>)}
      </div>
      {wait && <div className="fw-no-frame">{wait}</div>}
    </div></div>
    <div className="fw-wall-foot"><span className="fw-source-name">{source.kind === 'screen' ? <MonitorUp size={14}/> : <ImageIcon size={14}/>}<span title={sourceName(source)}>{sourceName(source)}</span>
      {source.kind !== 'demo' && <button className="fw-clear" onClick={onCloseSource} aria-label="Disconnect source" title="Disconnect source"><X size={13}/></button>}</span>
      <span className="fw-frame-note">{analysis.progress ? <><LoaderCircle className="fw-spin" size={13}/>Heavy sweep · {analysis.progress.camera}/{analysis.progress.total}</> : phase === 'checking' ? <><LoaderCircle className="fw-spin" size={13}/>Analysing…</> : phase === 'error' ? 'Analysis unavailable' : phase === 'no-frame' ? 'No frame' : screen && checkedAt ? <><ScanLine size={13}/>Checked {new Date(checkedAt).toLocaleTimeString()}</> : <><Layers2 size={13}/>Still frame</>}</span>
    </div>
  </section>;
}

function Results({ readings, grid, names, sampleLayout, phase, checkedAt }: { names?: string[]; readings: Reading[]; grid: Grid; sampleLayout: boolean; phase: string; checkedAt?: number }) {
  const [filter, setFilter] = useState<Filter>('all');
  const entries = readings.map((reading, i) => ({ reading, i })).filter(({ reading }) => filter === 'all' || reading.state === filter);
  const filters: Filter[] = ['all', 'occupied', 'empty'];
  if (readings.some(r => r.state === 'unclear') || filter === 'unclear') filters.push('unclear');
  return <section className="fw-panel fw-results" aria-label="Camera status">
    <div className="fw-results-head"><div className="fw-heading-group"><ScanLine size={18}/><h2>Camera status</h2></div><span className="fw-number-tag">{twoDigits(readings.length)}</span></div>
    <div className="fw-filters" role="group" aria-label="Filter camera results">{filters.map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All views' : stateLabel[f]}</button>)}</div>
    <ul className="fw-camera-list" aria-label="Per-camera occupancy">{entries.map(({ reading, i }) => <li key={i}>
      <div className={`fw-list-icon ${reading.state}`}><Cctv size={20} strokeWidth={1.65}/></div>
      <div className="fw-camera-name"><strong>Camera {twoDigits(i + 1)}</strong><span>{sampleLayout ? SAMPLE_NAMES[i] : names?.[i] || `Row ${Math.floor(i / grid.cols) + 1} · Column ${i % grid.cols + 1}`}</span>
        {reading.state === 'unclear' && <small>{reading.reason === 'weak' ? 'Weak person signal' : reading.reason === 'confirming-empty' ? 'Confirming vacancy' : reading.reason === 'poor-view' ? 'Poor visibility' : 'No reliable result'}</small>}</div>
      <Status state={reading.state} title={reading.score != null ? `Person model score ${reading.score.toFixed(2)} (not an accuracy estimate)` : undefined}/>
    </li>)}{!entries.length && <li className="fw-no-results"><Scan size={22}/>{`No ${filter} views in this result.`}</li>}</ul>
    <div className="fw-results-foot"><span className="fw-tiny-label"><Activity size={13}/> ANALYSIS</span><span>{phase === 'sample' ? 'Sample result' : phase === 'checking' ? 'Checking views…' : phase === 'ready' && checkedAt ? `Checked ${new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Not available'}</span></div>
  </section>;
}

function DetectorPanel({ mode, setMode, stats }: { mode: DetectionMode; setMode: (m: DetectionMode) => void; stats?: ScanStats }) {
  return <section className="fw-panel fw-detector" aria-label="Person detector settings">
    <div className="fw-heading-group"><SlidersHorizontal size={16}/><h2>Person detector</h2></div>
    <div className="fw-filters" role="group" aria-label="Detection mode">{(Object.keys(PROFILES) as DetectionMode[]).map(m =>
      <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>{PROFILES[m].label}</button>
    )}</div>
    <p>{PROFILES[mode].note}</p>
    {stats && <div className="fw-engine-stats" title="Worker processing time, excluding model load and screen capture"><span>Scan time <b>{stats.scanMs} ms</b></span><span>{stats.inferences} model {stats.inferences === 1 ? 'pass' : 'passes'}{stats.reused > 0 ? ` · ${stats.reused} unchanged` : ''}</span>{mode === 'heavy' && <span className="fw-covered">{stats.scanned}/{stats.total} views freshly scanned{stats.scanned < stats.total ? ' · remaining views unclear' : ''}</span>}</div>}
  </section>;
}

function Workspace({ source, grid, setGrid, mode, setMode, onCloseSource, journal }: { journal: VacancyJournal; source: Source; grid: Grid; setGrid: (g: Grid) => void; mode: DetectionMode; setMode: (m: DetectionMode) => void; onCloseSource: () => void }) {
  const [crop, setCrop] = useState<Rect>(FULL), [cropping, setCropping] = useState(false);
  const analysis = useAnalysis(source, grid, crop, mode, journal);
  const history = useSyncExternalStore(journal.subscribe, journal.snapshot, journal.snapshot);
  const names = history.layouts.find(l => l.id === history.active)?.names;
  return <>
    <Stats readings={analysis.readings}/>
    {analysis.phase === 'error' && <div className="fw-notice" role="alert"><Info size={17}/><span>The local detector could not run. Use a recent desktop browser with WebGL enabled. No views have been marked empty.</span><button onClick={analysis.retry}>Retry analysis</button></div>}
    <div className="fw-workspace"><CameraWall source={source} grid={grid} setGrid={setGrid} crop={crop} onCrop={() => setCropping(true)} analysis={analysis} onCloseSource={onCloseSource}/>
      <aside className="fw-aside"><Results readings={analysis.readings} grid={grid} names={names} sampleLayout={isSampleLayout(source, grid, crop)} phase={analysis.phase} checkedAt={analysis.checkedAt}/>
        <DetectorPanel mode={mode} setMode={setMode} stats={analysis.stats}/>
      </aside>
    </div>
    {cropping && <CropDialog source={source} current={crop} onClose={() => setCropping(false)} onApply={r => { setCrop(r); setCropping(false); }}/>}
  </>;
}

export default function Monitor() {
  const [grid, setGrid] = useState<Grid>(DEFAULT_GRID), [guide, setGuide] = useState(false);
  const [mode, setMode] = useState<DetectionMode>('heavy');
  const [journal] = useState(() => new VacancyJournal()), [view, setView] = useState<View>('monitor');
  useEffect(() => {
    try { journal.attach(window.localStorage); } catch { journal.attach(null); }
    const navigate = () => {
      const hash = window.location.hash.slice(1); setView(hash === 'vacancy' || hash === 'reminders' ? hash : 'monitor'); window.scrollTo(0, 0);
    };
    const finish = () => { const id = journal.snapshot().active; if (id) journal.finish(id); };
    navigate(); window.addEventListener('hashchange', navigate); window.addEventListener('pagehide', finish);
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('pagehide', finish); finish(); };
  }, [journal]);
  const restoreSample = useCallback(() => setGrid(DEFAULT_GRID), []);
  const input = useSource(restoreSample), fileInput = useRef<HTMLInputElement>(null);
  return <div className="fw">
    <header className="fw-top"><div className="fw-container fw-top-inner">
      <a href={HOME_URL} className="fw-brand" aria-label="Framewatch home"><BrandMark/><span>Framewatch</span></a>
      <span className="fw-nav-sep"/><nav className="fw-views" aria-label="Workspace views">{(Object.keys(VIEWS) as View[]).map(v =>
        <a key={v} href={`#${v}`} aria-current={view === v ? 'page' : undefined}>{VIEWS[v].tab}</a>)}</nav>
      <div className="fw-top-right"><span className="fw-local"><ShieldCheck size={15}/>On-device</span><span className="fw-nav-sep"/>
        <button className="fw-guide-btn" onClick={() => setGuide(true)}><BookOpen size={16}/>Quick guide</button></div>
    </div></header>
    <main className="fw-container fw-main">
      <div className="fw-hero"><div><div className="fw-eyebrow"><span className="fw-eyebrow-line"/>{VIEWS[view].eyebrow}</div><h1>{VIEWS[view].title}</h1>
        <p>{VIEWS[view].intro}</p></div>
        <div className="fw-actions"><input ref={fileInput} type="file" className="fw-hidden" aria-label="Open camera screenshot" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void input.openImage(file); }}/>
          {view !== 'monitor' ? <a href="#monitor" className="fw-btn"><MonitorIcon size={16}/>View monitor</a> : <button className="fw-btn" disabled={input.picking} onClick={() => fileInput.current?.click()}><Upload size={16}/>Open image</button>}
          {input.source.kind === 'screen' ? <button className="fw-btn fw-stop" onClick={input.clear}><Square size={14}/>Stop sharing</button> : <button className="fw-btn fw-primary" onClick={input.share} disabled={input.picking}>{input.picking ? <LoaderCircle size={17} className="fw-spin"/> : <MonitorUp size={17}/>}Share screen</button>}
        </div>
      </div>
      {input.notice && <div className={`fw-notice ${input.notice.info ? 'info' : ''}`} role={input.notice.info ? 'status' : 'alert'}><Info size={17}/><span>{input.notice.text}</span>
        {input.notice.sharing && PC_DOWNLOAD && <a href={PC_DOWNLOAD} download>Download PC copy <Download size={13}/></a>}
        <button className="fw-icon-btn" aria-label="Dismiss message" onClick={() => input.setNotice(null)}><X size={16}/></button></div>}
      {/* Changing dashboard tabs must not unmount the live source, canvas or worker. */}
      <div hidden={view !== 'monitor'}><Workspace journal={journal} key={input.revision} source={input.source} grid={grid} setGrid={setGrid} mode={mode} setMode={setMode} onCloseSource={input.clear}/>
        <a className="fw-history-link" href="#vacancy"><Clock3 size={19}/><span><strong>Vacancy history</strong> See the first and last empty check for each place.</span><ArrowRight size={16}/></a>
      </div>
      {view === 'vacancy' && <VacancyDashboard journal={journal} sharing={input.source.kind === 'screen'}/>}
      <Reminders journal={journal} visible={view === 'reminders'}/>
      <div className="fw-privacy"><div className="fw-privacy-icon"><LockKeyhole size={18}/></div><div><strong>Private by design</strong><span>Frames stay on this device and are never saved or uploaded. Vacancy history and reminder preferences stay in this browser.</span></div><ShieldCheck className="fw-privacy-stamp" size={26} strokeWidth={1.2}/></div>
    </main>
    <footer className="fw-container fw-footer"><span><BrandMark small/> Framewatch <b>/</b> Assure Intelligence</span><span className="fw-footer-label"><i/> LOCAL VISION ENGINE</span></footer>
    {guide && <Guide onClose={() => setGuide(false)}/>}
  </div>;
}
