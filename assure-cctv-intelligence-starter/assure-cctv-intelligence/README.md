# Framewatch — Assure camera occupancy monitor

Share the screen that already displays your CCTV cameras and see **which views contain a person**. No camera credentials, branch agent, Supabase account, or AI API key are required.

## Launch on your PC — no installation

1. Download [Framewatch-PC.zip](public/downloads/Framewatch-PC.zip) (also available in the hosted monitor under **Quick guide → Download for PC**).
2. On Windows, right-click the ZIP and choose **Extract All**. In the extracted folder, open **Framewatch.html** in a current **Microsoft Edge** or **Google Chrome** browser.
3. Open the window containing your CCTV cameras, click **Share screen** in Framewatch, and select the CCTV window. Match the grid and read **Camera status**. To try it without sharing, use **Open image** with the included `Example camera grid.webp`.

The PC copy runs from a local file. It includes the UI, fonts, worker, WebAssembly runtime and model; no Arena link, internet connection, server, Node.js, or account is needed. It uses the normal browser screen-sharing permission prompt. If device policy blocks capture, use a screenshot or consult your IT administrator. Close the tab to quit; double-click the HTML file to relaunch.

## Run from source (developers)

Use Node.js 22 or newer. In this directory:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. For a production build, run `npm run build` and `npm start`. The `predev` and `prebuild` scripts copy the pinned MediaPipe runtime from `node_modules` into the ignored `public/vision-runtime` directory. Deploy those static files along with `public/models`; no external model service is required.

## Check a screen

1. Click **Share screen** and choose the window or tab showing the camera grid. Choose the camera viewer, not Framewatch itself. Alternatively, click **Open image** to analyse a local PNG, JPG, or WebP screenshot (up to 25 MB).
2. Set the **columns × rows** selector on the camera wall to match your viewer (1–4 of each). If the screen includes menus or a sidebar, use **Crop to camera grid**. This assumes a rectangular grid of equally sized views.
3. Read the label on each tile or filter **Camera status** by result. **CAM 01** is the top left view; numbers continue across each row. These are positions on your screen, not IDs read from the cameras. For example, in a 2 × 2 grid, **Camera 03** is the bottom-left view.
4. Leave **Person detector** on **Balanced** to start. Choose **Detailed** for small people in distant views, or **Fast** for a slow PC. A mode, crop, or grid change rechecks the current source. An image is checked once per configuration. **Stop sharing**, the browser's stop button, or disconnecting the source releases the capture and clears its results. The initially displayed **Sample** wall is a synthetic example, not a live connection.

### Speed and detection modes

| Mode | What it checks | Live target interval¹ |
|---|---|---|
| Fast | One full-view person scan per camera that needs inference. | 0.4 s |
| Balanced (default) | Whole view, then up to two overlapping close-ups along the longer axis if a person wasn't clear in the full view. Stops once it has sufficient person evidence. | 0.6 s |
| Detailed | Whole view and up to four overlapping close-ups, using more of the source resolution. Useful for small people. Slower, particularly on large moving grids. | 0.9 s |

¹ Start-to-start targets, not promised frame rates. Only one frame is in flight; on slow hardware the next check waits for inference to finish and leaves a short rest. **Last scan** shows measured worker time (not model load/capture time), model passes, and unchanged views. A **model score** on an occupied badge is the detector's score, not a probability that the room is occupied.

Zooms use original camera pixels, not a magnified low-resolution model input. Boxes are mapped back to their own tile and duplicates are suppressed. Two agreeing weak boxes from different passes can support a person; duplicate proposals from one pass cannot. Very small views skip zooms that wouldn't contain useful detail. Brackets show detection evidence, **not an exhaustive people count**.

Live mode checks thumbnail quality and local changes on every sampled frame. It can reuse a stable result briefly, but forces a fresh whole-view scan when its 2.2–2.5 s age limit expires. Balanced can reuse negative close-ups for at most 4 s if those regions haven't changed. Age limits are evaluated at the next processed frame, and cache hits never extend them. Weak/invalid views do not become empty through reuse. After a person signal, the first miss is **Unclear — Confirming vacancy**; two fresh negative inferences on distinct video frames are needed to clear it. A blank or lost feed immediately produces **Unclear** on inspection, without any stale boxes. Switching camera input, layout, crop, or profile resets the per-view history. See the [benchmark and limitations](DETECTION-EVALUATION.md).

### What the labels mean

| Label | Meaning |
|---|---|
| Occupied | A person was detected in this tile. Brackets show the detected region. |
| Empty | No person was detected in a usable frame. This is an estimate, **not proof of an empty room**. |
| Unclear | The view is blank, very dark, too small, ambiguous, or could not be analysed. |
| Checking | Awaiting analysis of the new source, crop, or layout. |

Small, occluded or distant people can be missed. A frozen image, poster, or reflection can also give a misleading result. Check the image yourself before acting on a result.

### Privacy and compatibility

- Use a recent desktop browser with WebAssembly, WebGL2 and OffscreenCanvas. Screen capture requires a trustworthy browser context (HTTPS, localhost, or the extracted local HTML in a supporting browser), browser permission, and sometimes OS permission. If an embedded preview blocks sharing, use the PC copy or a screenshot.
- Only select a screen you are authorised to analyse. No microphone, recording, face recognition, uploads, local storage, or database writes. Frames and results are held in memory for the current session.
- Each pass freezes one frame, crops each camera cell and runs the COCO **EfficientDet-Lite0** person detector inside a local Web Worker. Only bounding boxes and occupancy labels return to the UI. The model, WASM, fonts and sample image are served by the web app itself or embedded in the portable HTML. See [model origin, checksum and licence](public/models/NOTICE.md).
- The default 2 × 2 sample uses results precomputed from that exact bundled image so the first screen does not need to load the model. Every user-selected source runs actual inference.

## Checks

```sh
npm test                        # region geometry, evidence fusion, TTL and vacancy confirmation
npm run build                   # Next.js production build and TypeScript check
npx playwright install chromium # one-time, for optional browser tests
npm run test:browser            # exercises the real local model and capture lifecycle
npm run package:pc              # rebuild public/downloads/Framewatch-PC.zip from this source
npm run test:pc                 # test extracted HTML offline, using file:// and synthetic capture
```

## Existing starter components

The original read-only registry dashboard is retained at `/overview`, with `/centres`, `/cameras`, and `/connectors`. **Only those registry pages** use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. The schema in `supabase/schema.sql` enables authenticated reads, not production admin enforcement. Never put a service-role key in the browser. The branch connector under `branch-connector/` remains a placeholder; the screen monitor does not use it, open camera ports, connect to RTSP, or send occupancy events to the registry.
