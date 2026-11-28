// Real desktop server + extracted HTML; the ONLY recorder is a private TLS
// contract fixture. The WebRTC sender below is a real browser peer, not a video URL.
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { installLiveWall } from '../live-wall.mjs';

let dir,
  recorder,
  address,
  launcher,
  app,
  owner,
  answer,
  jpg,
  clip,
  expired = false,
  unavailable = false;
const calls = [];
test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'Framewatch site '));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const zip = unzipSync(await readFile(join(root, 'public/downloads/Framewatch-PC.zip')));
  const pe = Buffer.from(zip['Framewatch.exe']);
  const p = pe.readUInt32LE(0x3c);
  expect(pe.toString('ascii', p, p + 4)).toBe('PE\0\0');
  expect(pe.readUInt16LE(p + 4)).toBe(0x8664);
  await writeFile(join(dir, 'Framewatch.html'), zip['Framewatch.html']);
  const exe = join(dir, process.platform === 'win32' ? 'Framewatch.exe' : 'launcher');
  if (process.platform === 'win32') await writeFile(exe, pe); // run the exact shipped Windows binary
  else execFileSync(process.env.GO_BIN || 'go', ['build', '-trimpath', '-o', exe, '.'], {
    cwd: join(root, 'desktop'), env: { ...process.env, GOPROXY: 'off', GOTOOLCHAIN: 'local' },
  });
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      'test.key',
      '-out',
      'frigate-ca.pem',
      '-days',
      '1',
      '-subj',
      '/CN=Framewatch test',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { cwd: dir, stdio: 'ignore' },
  );
  recorder = createServer(
    { key: await readFile(join(dir, 'test.key')), cert: await readFile(join(dir, 'frigate-ca.pem')) },
    async (req, res) => {
      try {
        const url = new URL(req.url, 'https://test.local'),
          path = url.pathname;
        calls.push(path);
        const json = (v, code = 200) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(v));
        };
        if (path === '/api/login') {
          let body = '';
          for await (const b of req) body += b;
          const v = JSON.parse(body);
          if (v.user !== 'tester' || v.password !== 'fixture password') return json({}, 401);
          expired = false;
          res.setHeader('Set-Cookie', 'frigate_token=fixture_session; Path=/; HttpOnly; Secure');
          return json({});
        }
        if (expired || !req.headers.cookie?.includes('frigate_token=fixture_session')) return json({}, 401);
        if (path === '/api/config')
          return json({ cameras: { hall: { live: { streams: { Main: 'hall_hd' } } } } });
        if (path === '/api/stats' && unavailable) return json({}, 503);
        if (path === '/api/stats')
          return json({
            service: { version: '0.18.3' },
            cameras: { hall: { camera_fps: 25, detection_fps: 5 }, gate: { camera_fps: 0, detection_fps: 0 } },
            privateData: 'not in renderer',
          });
        if (path === '/api/events')
          return json([
            {
              id: '1-a',
              camera: 'hall',
              label: 'person',
              start_time: 1700000100,
              end_time: 1700000108,
              has_clip: true,
              has_snapshot: true,
              zones: ['entrance'],
            },
            {
              id: '2-b',
              camera: 'gate',
              label: 'car',
              start_time: 1700000000,
              end_time: null,
              has_clip: false,
              has_snapshot: false,
              zones: [],
            },
          ]);
        if (path.endsWith('.jpg')) {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          return res.end(jpg);
        }
        if (path.endsWith('/clip.mp4')) {
          const start = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
          res.writeHead(req.headers.range ? 206 : 200, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Length': String(clip.length - start),
            ...(req.headers.range
              ? { 'Content-Range': `bytes ${start}-${clip.length - 1}/${clip.length}` }
              : {}),
          });
          return res.end(clip.subarray(start));
        }
        if (path === '/api/go2rtc/webrtc' && url.searchParams.get('src') === 'hall_hd' && answer) {
          let offer = '';
          for await (const b of req) offer += b;
          return json(await answer(JSON.parse(offer)));
        }
        json({}, 404);
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    },
  );
  recorder.listen(0, '127.0.0.1');
  await once(recorder, 'listening');
  address = `https://127.0.0.1:${recorder.address().port}`;
  launcher = spawn(exe, ['-port', '0', '-no-browser'], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
  app = await new Promise((ok, no) => {
    let buf = '';
    launcher.on('error', no);
    launcher.once('exit', () => no(Error('launcher exited')));
    launcher.stdout.on('data', (s) => {
      buf += s;
      const m = buf.match(/Open locally: (http:\/\/[^\s]+#frigate)/);
      if (m) ok(m[1]);
    });
  });
});
test.afterAll(async () => {
  await owner?.close();
  if (launcher && launcher.exitCode === null) {
    const done = once(launcher, 'exit');
    launcher.kill();
    await done;
  }
  if (recorder) {
    recorder.closeAllConnections();
    await new Promise((r) => recorder.close(r));
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('sign in locally, play actual WebRTC pixels and retained media, review and disconnect', async ({
  page,
  browser,
}) => {
  owner = await browser.newPage();
  await owner.goto(app); // same trustworthy local origin, independent tab; no camera permission
  const assets = await owner.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d');
    let n = 0;
    const paint = () => {
      ctx.fillStyle = ++n % 2 ? '#98c95c' : '#359a79';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#111';
      ctx.fillText(String(n), 20, 50);
    };
    paint();
    window.paintTimer = setInterval(paint, 60);
    window.testVideo = c.captureStream(15);
    return c.toDataURL('image/jpeg').split(',')[1];
  });
  jpg = Buffer.from(assets, 'base64');
  clip = await readFile(new URL('./fixtures/pattern.mp4', import.meta.url));
  answer = (offer) =>
    owner.evaluate(async (offer) => {
      const pc = (window.sender = new RTCPeerConnection({ iceServers: [] }));
      pc.addTrack(window.testVideo.getVideoTracks()[0], window.testVideo);
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      if (pc.iceGatheringState !== 'complete')
        await new Promise((r) => {
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') r();
          };
          setTimeout(r, 3000);
        });
      return pc.localDescription.toJSON();
    }, offer);
  const outward = [];
  page.on('request', (req) => {
    if (req.url().startsWith('https:')) outward.push(req.url());
  });
  await page.goto(app);
  await page.getByLabel('Recorder HTTPS address').fill(address);
  await page.getByLabel('Frigate username').fill('tester');
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Connect recorder' }).click();
  await expect(page.getByRole('alert')).toContainText('sign-in failed');
  await page.getByLabel('Password', { exact: true }).fill('fixture password');
  await page.getByRole('button', { name: 'Connect recorder' }).click();
  await expect(page.getByLabel('Recorder summary')).toContainText('02');
  await page.locator('.fr-camera-list button').filter({ hasText: 'hall' }).click();
  await expect.poll(() => page.locator('.fr-player img').evaluate((im) => im.naturalWidth)).toBe(320);
  await page.getByRole('button', { name: 'Watch live' }).click();
  await expect(page.getByText('● LIVE · WebRTC')).toBeVisible();
  await expect
    .poll(() =>
      page.getByLabel('Frigate live video').evaluate((v) => v.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(2);
  await owner.evaluate(() => window.sender.getSenders()[0].replaceTrack(null));
  await expect(page.getByText('No recent video frames.', {exact:false})).toBeVisible();
  await owner.evaluate(() => window.sender.getSenders()[0].replaceTrack(window.testVideo.getVideoTracks()[0]));
  await expect(page.getByText('● LIVE · WebRTC')).toBeVisible();
  await page.getByRole('button', { name: 'Stop live view' }).click();
  await expect(page.getByLabel('Frigate live video')).toHaveCount(0);
  const list = page.getByRole('region', { name: 'Recorder event timeline' });
  await expect(list).toBeVisible();
  await list.getByRole('combobox', { name: 'Object', exact: true }).selectOption('car');
  await expect(list.locator('li')).toHaveCount(1);
  await list.getByLabel('With clips').check();
  await expect(list).toContainText('No detections match');
  await list.getByRole('combobox', { name: 'Object', exact: true }).selectOption('person');
  await list.getByRole('button', { name: 'Review person event from hall' }).click();
  const modal = page.getByRole('dialog');
  await expect.poll(() => modal.getByAltText('Event snapshot').evaluate((im) => im.naturalWidth)).toBe(320);
  await modal.getByRole('button', { name: 'Play clip' }).click();
  await expect.poll(() => modal.getByLabel('Event recording').evaluate((v) => v.videoWidth)).toBe(320);
  await modal.getByRole('button', { name: 'Close dialog' }).click();
  // Recorder-only viewing has not created any synthetic iVMS vacancy observations.
  await page.getByRole('link', { name: 'Vacancy dashboard', exact: true }).click();
  await expect(page.getByText('No empty periods observed yet')).toBeVisible();
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Occupancy monitor' })).toBeVisible();
  await installLiveWall(page);
  await page.getByRole('button', { name: 'Fast', exact:true }).click();
  await page.getByLabel('Camera grid: columns by rows').selectOption('2x1');
  await page.getByRole('button', {name:'Share screen'}).click();
  await expect(page.locator('.fw-results-foot')).toContainText('Checked');
  await page.getByRole('link', { name: 'Frigate', exact: true }).click();
  await expect(page.getByRole('button', {name:'Stop sharing'})).toBeVisible();
  await expect(list).toBeVisible();
  unavailable = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('last successful inventory');
  await expect(list).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(list).toBeVisible();
  expired = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(list).toHaveCount(0);
  await page.getByLabel('Recorder HTTPS address').fill(address);
  await page.getByLabel('Frigate username').fill('tester');
  await page.getByLabel('Password', { exact: true }).fill('fixture password');
  await page.getByRole('button', { name: 'Connect recorder' }).click();
  await expect(list).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect recorder' })).toBeVisible();
  await expect(list).toHaveCount(0);
  const exited = once(launcher, 'exit');
  await page.getByRole('button', { name: 'Quit desktop app' }).click();
  await page.getByRole('button', { name: 'Quit Framewatch', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Framewatch has closed' })).toBeVisible();
  expect((await exited)[0]).toBe(0);
  expect(await page.evaluate(() => window.wallTrack.readyState)).toBe('ended');
  expect(outward).toEqual([]);
  expect((await page.context().cookies()).some((c) => c.name === 'frigate_token')).toBe(false);
  expect(calls.filter((p) => p === '/api/login')).toHaveLength(3);
});
