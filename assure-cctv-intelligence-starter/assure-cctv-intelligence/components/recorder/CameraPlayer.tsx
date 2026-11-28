'use client';
import { useEffect, useRef, useState } from 'react';
import { Cctv, Image as ImageIcon, Play, RefreshCw, Square } from 'lucide-react';
import { callRecorder, friendly, mediaURL, type Camera } from '@/lib/recorder/client';
import { watchFrames, type FrameClock } from '@/lib/monitor/live-frames';
import { SAMPLE_URL } from '@/lib/monitor/platform';

export function SampleFrame({ index }: { index: number }) {
  return (
    <div
      className="fr-sample-frame"
      role="img"
      aria-label="Illustrated sample camera frame"
      style={{
        backgroundImage: `url("${SAMPLE_URL}")`,
        backgroundPosition: `${(index % 2) * 100}% ${Math.floor(index / 2) * 100}%`,
      }}
    />
  );
}
function LiveFeed({ camera, stream }: { camera: string; stream: string }) {
  const video = useRef<HTMLVideoElement>(null),
    [phase, setPhase] = useState('Connecting to the live stream…'),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const el = video.current!,
      ac = new AbortController();
    let pc: RTCPeerConnection | undefined,
      disposed = false,
      failed = false;
    let clock: FrameClock | undefined, received = false, tick: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      ac.abort();
      clearInterval(tick);
      clock?.close();
      pc?.close();
      el.srcObject = null;
    };
    const fail = (msg: string) => {
      if (disposed || failed) return;
      failed = true;
      setReady(false);
      setPhase(msg);
      close();
    };
    const hide = () => {
      if (document.hidden)
        fail('Live video paused while the window was hidden. Stop live view, then start it again.');
    };
    document.addEventListener('visibilitychange', hide);
    const timeout = setTimeout(
      () =>
        fail(
          'No live video arrived. Check the go2rtc stream, LAN WebRTC candidates and camera codec; the snapshot is still available.',
        ),
      20000,
    );
    // A negotiated peer or a playing event alone does not prove a fresh picture.
    // Use the same decoded-frame clock as the iVMS monitor (no model passes).
    const checkFrames = () => {
      if (disposed || failed) return;
      if (clock?.read()) {
        if (!received) { received = true; clearTimeout(timeout); setReady(true); }
      } else if (received) {
        received = false; setReady(false); setPhase('No recent video frames. Waiting for the stream to resume…');
      }
    };
    (async () => {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (e) => {
        if (!disposed && !failed) {
          e.track.onended = () => fail('The recorder ended the stream.');
          el.srcObject = e.streams[0] ?? new MediaStream([e.track]);
          clearInterval(tick); clock?.close();
          clock = watchFrames(el, e.track); clock.onResume(checkFrames);
          tick = setInterval(checkFrames, 1000);
          void el.play().catch(() => fail('The browser could not play this stream. Try an H.264 stream.'));
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected')
          fail('Live connection lost. Stop live view and try again.');
      };
      await pc.setLocalDescription(await pc.createOffer());
      if (ac.signal.aborted) return;
      // Non-trickle offer for Frigate’s authenticated go2rtc HTTP endpoint.
      if (pc.iceGatheringState !== 'complete')
        await new Promise<void>((resolve) => {
          const peer = pc!;
          const done = () => {
            clearTimeout(timer);
            peer.removeEventListener('icegatheringstatechange', check);
            ac.signal.removeEventListener('abort', done);
            resolve();
          };
          const check = () => {
            if (peer.iceGatheringState === 'complete') done();
          };
          const timer = setTimeout(done, 3000);
          peer.addEventListener('icegatheringstatechange', check);
          ac.signal.addEventListener('abort', done, { once: true });
          check();
        });
      if (ac.signal.aborted) return;
      const answer = await callRecorder<RTCSessionDescriptionInit>('live', ac.signal, {
        camera,
        stream,
        sdp: pc.localDescription?.sdp,
      });
      if (!ac.signal.aborted) await pc.setRemoteDescription(answer);
    })().catch(() =>
      fail(
        'Live stream unavailable. Check Frigate’s go2rtc setup and camera permissions, or switch to the snapshot.',
      ),
    );
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', hide);
      clearTimeout(timeout);
      close();
    };
  }, [camera, stream]);
  return (
    <div className="fr-picture">
      <video ref={video} muted playsInline autoPlay aria-label="Frigate live video" />
      {!ready && (
        <p role="status" className="fr-placeholder">
          {phase}
        </p>
      )}
      {ready && <span className="fr-picture-tag">● LIVE · WebRTC</span>}
    </div>
  );
}
export function CameraPlayer({ camera, demo, index }: { camera: Camera; demo: boolean; index: number }) {
  const [live, setLive] = useState(false),
    [seq, setSeq] = useState(0),
    [bad, setBad] = useState(false),
    [stream, setStream] = useState(camera.streams[0]);
  const active = camera.streams.includes(stream) ? stream : camera.streams[0];
  return (
    <section className="fw-panel fr-player" aria-label="Selected camera">
      <div className="fw-panel-head">
        <div className="fw-heading-group">
          <Cctv size={18} />
          <h2>{friendly(camera.id)}</h2>
        </div>
        <span className="fr-tag">{demo ? 'Sample' : live ? 'Live view' : 'Recorder still'}</span>
      </div>
      {live ? (
        <LiveFeed key={active} camera={camera.id} stream={active} />
      ) : (
        <div className="fr-picture">
          {demo ? (
            <SampleFrame index={index} />
          ) : !bad ? (
            <img
              src={`${mediaURL('camera', camera.id)}?v=${seq}`}
              alt={`Snapshot from ${camera.id}`}
              onError={() => setBad(true)}
            />
          ) : (
            <p className="fr-placeholder" role="status">
              No snapshot available for this camera.
            </p>
          )}
          <span className="fr-picture-tag">
            <ImageIcon size={12} /> {demo ? 'DEMO FRAME' : 'SNAPSHOT · NOT LIVE'}
          </span>
        </div>
      )}
      <div className="fr-player-foot">
        <div>
          <b>
            {demo
              ? 'Illustrated preview'
              : live
                ? 'Direct video from your recorder'
                : 'Latest available snapshot'}
          </b>
          <p>
            {demo
              ? 'Connect your recorder to watch live footage.'
              : live
                ? 'Receive-only. No microphone or camera permission needed.'
                : 'Frigate may return a cached image when a camera is offline.'}
          </p>
        </div>
        {!demo && (
          <div className="fr-controls">
            {camera.streams.length > 1 && (
              <select aria-label="Live stream" value={active} onChange={(e) => setStream(e.target.value)}>
                {camera.streams.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            {!live && (
              <button
                className="fw-btn"
                onClick={() => {
                  setBad(false);
                  setSeq((n) => n + 1);
                }}
                aria-label="Refresh camera snapshot"
              >
                <RefreshCw size={15} />
              </button>
            )}
            <button className="fw-btn fw-primary" onClick={() => setLive(!live)}>
              {live ? (
                <>
                  <Square size={14} />
                  Stop live view
                </>
              ) : (
                <>
                  <Play size={15} />
                  Watch live
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
