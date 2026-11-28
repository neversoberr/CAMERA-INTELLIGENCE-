'use client';
import { useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowRight,
  Cable,
  Cctv,
  ChevronRight,
  Download,
  HardDrive,
  Layers,
  LockKeyhole,
  MonitorPlay,
  PlugZap,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import { DESKTOP_RECORDER, PC_DOWNLOAD } from '@/lib/monitor/platform';
import { demoRecorder, friendly, type RecorderState } from '@/lib/recorder/client';
import { CameraPlayer } from './CameraPlayer';
import { RecorderEvents } from './RecorderEvents';
import { useRecorder } from './use-recorder';
import './recorder.css';
const features = [
  {
    Icon: MonitorPlay,
    title: 'Camera desk',
    text: 'Choose an authorised camera, inspect its snapshot or start a low-delay live stream.',
  },
  {
    Icon: Layers,
    title: 'Detection timeline',
    text: 'Filter recent objects and review the media retained by your recorder.',
  },
  {
    Icon: ShieldCheck,
    title: 'Read-only connection',
    text: 'No changes to recording rules, cameras or saved events.',
  },
];
function Connect({
  openDemo,
  loading,
  submit,
}: {
  openDemo: () => void;
  loading: boolean;
  submit: (fields: object) => void;
}) {
  function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      v = new FormData(form);
    submit({ address: v.get('address'), user: v.get('user'), password: v.get('password') });
    (form.elements.namedItem('password') as HTMLInputElement).value = '';
  }
  return (
    <div className="fr-onboard">
      <section className="fw-panel fr-welcome">
        <div className="fr-label">
          <HardDrive size={16} /> RECORDER CONNECTION
        </div>
        <h2>Bring your cameras into Framewatch.</h2>
        <p>
          Connect to the Frigate dashboard you already use on this network. No screen share is needed for
          recorder video or events.
        </p>
        {DESKTOP_RECORDER ? (
          <form className="fr-form" onSubmit={signIn} autoComplete="off">
            <label>
              Recorder HTTPS address
              <input
                name="address"
                type="url"
                placeholder="https://recorder.example:8971"
                required
                maxLength={1024}
              />
            </label>
            <div>
              <label>
                Frigate username
                <input name="user" required maxLength={160} spellCheck={false} autoCapitalize="none" />
              </label>
              <label>
                Password
                <input name="password" type="password" required maxLength={1024} autoComplete="off" />
              </label>
            </div>
            <button className="fw-btn fw-primary" disabled={loading}>
              <PlugZap size={16} />
              {loading ? 'Contacting recorder…' : 'Connect recorder'}
            </button>
            <small>
              Use a viewer account. Its session stays in the launcher’s memory until disconnect or exit.
            </small>
          </form>
        ) : (
          <div className="fr-desktop-note">
            <b>Connect from the camera-site PC</b>
            <p>
              Extract the Windows app and open <strong>Framewatch.exe</strong>. Only that local app accepts your
              recorder sign-in.
            </p>
            {PC_DOWNLOAD && (
              <a className="fw-btn fw-primary" href={PC_DOWNLOAD} download>
                <Download size={16} />
                Download Windows app
              </a>
            )}
          </div>
        )}
      </section>
      <section className="fw-panel fr-tour">
        <div className="fr-label">IN THIS WORKSPACE</div>
        {features.map(({ Icon: I, title, text }) => {
          return (
            <div className="fr-tour-row" key={title}>
              <I size={20} />
              <div>
                <b>{title}</b>
                <p>{text}</p>
              </div>
            </div>
          );
        })}
        <button className="fw-btn" onClick={openDemo} disabled={loading}>
          Explore sample recorder <ArrowRight size={14} />
        </button>
      </section>
    </div>
  );
}
function Desk({ data, demo, stale }: { data: RecorderState; demo: boolean; stale: boolean }) {
  const [id, setId] = useState('');
  const cam = data.cameras.find((c) => c.id === id) ?? data.cameras[0];
  const metrics = [
    { t: 'Camera inventory', v: data.cameras.length, I: Cctv },
    { t: 'Reporting frames', v: data.cameras.filter((c) => (c.fps ?? 0) > 0).length, I: Activity },
    { t: 'Recent detections', v: data.events.length, I: ScanLine },
    { t: 'Events with clips', v: data.events.filter((e) => e.has_clip).length, I: Layers },
  ];
  return (
    <>
      <dl className="fw-stats" aria-label="Recorder summary">
        {metrics.map(({ t, v, I }) => (
          <div className="fw-stat" key={t}>
            <span className="fw-stat-glyph">
              <I size={21} />
            </span>
            <div>
              <dt>{t}</dt>
              <dd>{String(v).padStart(2, '0')}</dd>
            </div>
            <span className="fw-stat-line" />
          </div>
        ))}
      </dl>
      <div className="fr-wall">
        {cam && !stale ? (
          <CameraPlayer key={cam.id} camera={cam} demo={demo} index={data.cameras.indexOf(cam)} />
        ) : (
          <div className="fw-panel fr-empty">
            {stale ? 'Recorder data is stale. Refresh to reopen media.' : 'No cameras visible to this account.'}
          </div>
        )}
        <section className="fw-panel fr-inventory">
          <div className="fw-panel-head">
            <div className="fw-heading-group">
              <HardDrive size={17} />
              <h2>Cameras</h2>
            </div>
            <span className="fr-tag">{data.cameras.length} sources</span>
          </div>
          <div className="fr-camera-list">
            {data.cameras.map((c) => (
              <button key={c.id} onClick={() => setId(c.id)} aria-pressed={c.id === cam?.id}>
                <Cctv size={19} />
                <span>
                  <b>{friendly(c.id)}</b>
                  <small>
                    {c.fps == null ? 'Input rate unknown' : `${c.fps} input fps`} · {c.detectionFps ?? '—'}{' '}
                    detection fps
                  </small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>
      </div>
      {!stale && <RecorderEvents data={data} demo={demo} />}
    </>
  );
}
export function RecorderWorkspace() {
  const { data, error, busy, act } = useRecorder(),
    [demo, setDemo] = useState<RecorderState | null>(null);
  const view = data ?? demo,
    isDemo = !data && !!demo;
  return (
    <div className="fr-workspace">
      {error && (
        <div className="fw-notice" role="alert">
          <Cable size={17} />
          <span>
            {error} {data ? 'Showing the last successful inventory.' : ''}
          </span>
        </div>
      )}
      {view ? (
        <>
          <div className="fr-session">
            <div>
              <span className={'fr-signal ' + (error || isDemo ? 'idle' : '')} />
              <b>{isDemo ? 'Sample recorder' : error ? 'Connection interrupted' : view.address}</b>
              <span>
                {isDemo
                  ? 'Illustrated data · not connected'
                  : `${view.version ? 'Frigate ' + view.version + ' · ' : ''}Updated ${new Date(view.updated).toLocaleTimeString()}`}
              </span>
            </div>
            <div>
              {!isDemo && (
                <button className="fw-btn" disabled={!!busy} onClick={() => void act('state')}>
                  <RefreshCw size={14} />
                  {busy === 'state' ? 'Refreshing…' : 'Refresh'}
                </button>
              )}
              <button
                className="fw-btn"
                disabled={busy === 'disconnect'}
                onClick={() => {
                  setDemo(null);
                  if (!isDemo) void act('disconnect', {});
                }}
              >
                <Unplug size={14} />
                {isDemo ? 'Exit sample' : 'Disconnect'}
              </button>
            </div>
          </div>
          <Desk
            key={isDemo ? 'sample' : view.address}
            data={view}
            demo={isDemo}
            stale={!!data && (!!error || busy === 'disconnect')}
          />
        </>
      ) : (
        <Connect
          loading={!!busy}
          submit={(v) => void act('connect', v)}
          openDemo={() => setDemo(demoRecorder())}
        />
      )}
      <p className="fr-boundary">
        <LockKeyhole size={14} /> Recorder detections are separate from the iVMS vacancy journal and reminders.
        Missing detections are not evidence of vacancy.
      </p>
    </div>
  );
}
