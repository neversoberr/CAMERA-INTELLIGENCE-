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
4. A shared screen is checked again about two seconds **after** each pass completes. An image is checked once. **Stop sharing**, the browser's stop button, or disconnecting the source releases the capture and clears its results. The initially displayed **Sample** wall is a synthetic example, not a live connection.

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
npm test                        # grid geometry, frame quality, classification
npm run build                   # Next.js production build and TypeScript check
npx playwright install chromium # one-time, for optional browser tests
npm run test:browser            # exercises the real local model and capture lifecycle
npm run package:pc              # rebuild public/downloads/Framewatch-PC.zip from this source
npm run test:pc                 # test extracted HTML offline, using file:// and synthetic capture
```

## Existing starter components

The original read-only registry dashboard is retained at `/overview`, with `/centres`, `/cameras`, and `/connectors`. **Only those registry pages** use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. The schema in `supabase/schema.sql` enables authenticated reads, not production admin enforcement. Never put a service-role key in the browser. The branch connector under `branch-connector/` remains a placeholder; the screen monitor does not use it, open camera ports, connect to RTSP, or send occupancy events to the registry.
