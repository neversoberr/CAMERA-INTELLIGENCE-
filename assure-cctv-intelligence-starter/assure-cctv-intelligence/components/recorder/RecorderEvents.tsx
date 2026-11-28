'use client';
import { useState } from 'react';
import { Clock3, Film, Image as ImageIcon, ScanLine } from 'lucide-react';
import { Dialog } from '../monitor/dialogs';
import { friendly, mediaURL, type RecorderEvent, type RecorderState } from '@/lib/recorder/client';
import { SampleFrame } from './CameraPlayer';
const stamp = (sec: number) =>
  new Date(sec * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
function Evidence({
  item,
  demo,
  index,
  close,
}: {
  item: RecorderEvent;
  demo: boolean;
  index: number;
  close: () => void;
}) {
  const [clip, setClip] = useState(!item.has_snapshot && item.has_clip),
    [bad, setBad] = useState(false);
  return (
    <Dialog
      wide
      title={`${friendly(item.label)} · ${friendly(item.camera)}`}
      eyebrow={demo ? 'SAMPLE EVENT' : 'RECORDER EVIDENCE'}
      onClose={close}
    >
      <p className="fr-muted">
        <Clock3 size={14} /> {stamp(item.start_time)} ·{' '}
        {item.end_time === null
          ? 'Ongoing at last refresh'
          : `${Math.max(0, Math.round(item.end_time - item.start_time))} s duration`}
      </p>
      <div className="fr-controls fr-media-options" aria-label="Event media">
        <button
          className="fw-btn"
          disabled={!item.has_snapshot}
          aria-pressed={!clip}
          onClick={() => {
            setClip(false);
            setBad(false);
          }}
        >
          <ImageIcon size={15} />
          Snapshot
        </button>
        <button
          className="fw-btn"
          disabled={!item.has_clip}
          aria-pressed={clip}
          onClick={() => {
            setClip(true);
            setBad(false);
          }}
        >
          <Film size={15} />
          Play clip
        </button>
      </div>
      <div className="fr-picture fr-event-picture">
        {bad ? (
          <p className="fr-placeholder" role="status">
            This evidence is unavailable. It may have expired, or the browser cannot play its codec.
          </p>
        ) : demo ? (
          <SampleFrame index={index} />
        ) : clip ? (
          <video
            src={mediaURL('clip', item.id)}
            controls
            autoPlay
            playsInline
            onError={() => setBad(true)}
            aria-label="Event recording"
          />
        ) : item.has_snapshot ? (
          <img src={mediaURL('snapshot', item.id)} alt="Event snapshot" onError={() => setBad(true)} />
        ) : (
          <p className="fr-placeholder">No media retained for this event.</p>
        )}
      </div>
      <p className="fr-caption">
        {item.zones?.length ? `Zones: ${item.zones.map(friendly).join(', ')}` : 'No zone reported'} ·{' '}
        {demo ? 'Illustrated example' : 'Detection reported by Frigate'}
      </p>
    </Dialog>
  );
}
export function RecorderEvents({ data, demo }: { data: RecorderState; demo: boolean }) {
  const [cam, setCam] = useState(''),
    [label, setLabel] = useState(''),
    [onlyClips, setOnlyClips] = useState(false),
    [limit, setLimit] = useState(8),
    [item, setItem] = useState<RecorderEvent | null>(null);
  const rows = data.events.filter(
    (e) => (!cam || e.camera === cam) && (!label || e.label === label) && (!onlyClips || e.has_clip),
  );
  return (
    <section className="fw-panel fr-events" aria-label="Recorder event timeline">
      <div className="fw-panel-head">
        <div className="fw-heading-group">
          <ScanLine size={18} />
          <h2>Detection timeline</h2>
        </div>
        <span className="fr-tag">Latest {data.events.length} events</span>
      </div>
      <div className="fr-event-filters">
        <label>
          Camera
          <select
            value={cam}
            onChange={(e) => {
              setCam(e.target.value);
              setLimit(8);
            }}
          >
            <option value="">All cameras</option>
            {data.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {friendly(c.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Object
          <select
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setLimit(8);
            }}
          >
            <option value="">All objects</option>
            {Array.from(new Set([...data.events.map((e) => e.label), ...(label ? [label] : [])]))
              .sort()
              .map((l) => (
                <option key={l}>{l}</option>
              ))}
          </select>
        </label>
        <label className="fr-check">
          <input
            type="checkbox"
            checked={onlyClips}
            onChange={(e) => {
              setOnlyClips(e.target.checked);
              setLimit(8);
            }}
          />
          With clips
        </label>
      </div>
      {rows.length ? (
        <ul className="fr-event-list">
          {rows.slice(0, limit).map((e) => (
            <li key={e.id}>
              <span className="fr-event-dot" />
              <div>
                <b>{friendly(e.label)}</b>
                <span>
                  {friendly(e.camera)} · {stamp(e.start_time)}
                </span>
              </div>
              <button
                className="fw-btn"
                aria-label={`Review ${e.label} event from ${e.camera}`}
                onClick={() => setItem(e)}
              >
                Review
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-empty">No detections match this view. No events does not mean a place is empty.</p>
      )}
      <div className="fr-tail">
        <span>
          Showing {Math.min(limit, rows.length)} of {rows.length} matching · local time
        </span>
        {limit < rows.length && (
          <button className="fw-btn" onClick={() => setLimit((n) => n + 8)}>
            Show more
          </button>
        )}
      </div>
      {item && (
        <Evidence
          key={item.id}
          item={item}
          index={data.cameras.findIndex((c) => c.id === item.camera)}
          demo={demo}
          close={() => setItem(null)}
        />
      )}
    </section>
  );
}
