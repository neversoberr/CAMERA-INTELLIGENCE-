# Person detection: what changed and what was measured

The target decision is **does this camera view contain a visible person?** Framewatch 0.2 uses the same local COCO EfficientDet-Lite0 weights as 0.1. The change is the inference pipeline: multiple image scales, evidence fusion, bounded reuse and live vacancy confirmation. No identities, remote inference or training on user screens.

## Presence check on labelled photos

Compared the worker from `73af58e` with the new **Balanced** worker using the same model/runtime. Each of the 128 photos was passed independently as a full-resolution 1×1 still (new history, no temporal votes or caching). A photo is positive if its COCO annotations include at least one `person`. All images and all **Unclear** results are included.

| Ground truth | Previous: occupied / empty / unclear | Balanced: occupied / empty / unclear |
|---|---:|---:|
| Person present (61) | 55 / 4 / 2 | **58 / 2 / 1** |
| No labelled person (67) | 2 / 65 / 0 | **2 / 65 / 0** |

This is an image-level smoke test, **not** box mAP, a benchmark of every person in a crowd, or a promised deployment accuracy. [COCO128 snapshot](https://github.com/developer0hye/COCO128/tree/47a3de30aaf7ad1c02105bd80598fb03ac0d0789) is a small subset of COCO **training** images; its `val2017` copy is not an independent held-out CCTV dataset. The images are not shipped in this repository or app. There is also a controlled synthetic regression: a scaled 60-pixel-tall figure on one side of a two-camera wall must yield an occupied label and a correctly positioned box in that camera only.

## Local timing

One two-vCPU Linux sandbox, headless Chromium 133, software WebGL and the CPU/WASM model. Rounded medians below (upper middle observation). No cold model download/load time included. Both revisions used the same inputs and browser; results will vary on a user's PC.

| Measurement | Previous | Balanced |
|---|---:|---:|
| Completed updates, extracted PC HTML, changing 2×2 wall | 2.87 s apart | **1.05 s apart** |
| Worker round trip, unchanged 2×2 wall | 306 ms | **132 ms** |
| Worker round trip, two of four views changing | 338 ms | **388 ms** |
| Worker round trip, independent single photos | 78 ms | **216 ms** |

**Trade-off:** close-ups cost real inference time on changed/empty scenes. Updates arrive sooner because static evidence can be reused briefly and the UI no longer waits a fixed 2.2 s *after* every pass. Fast mode omits the close-ups. Detailed scans can take substantially longer, particularly across 16 changing views.

For the worker benchmark, 12 warm passes per grid, 500 ms idle between passes; the changing case swaps the two top camera views on alternate passes. The PC timing uses a synthetic 4 fps MediaStream, swaps the two top views after each completed result, and measures four warm result-to-result intervals through the actual UI scheduler with networking disabled. These are spot timings, not a video frame-rate guarantee.

## Repeat the measurements (developers only)

With Node 22+, app dependencies and Playwright Chromium installed, run the web app. From the project directory, in another terminal:

```sh
npm run benchmark                       # warm static/changing worker timings
# Set COCO_DIR to a local copy with annotations/instances_val2017.json and val2017/*.jpg
# to include the labelled presence matrix. Set SCAN_MODE to fast, balanced or detail.
# Optional BENCH_WORKER_DIR: serve worker.js and analysis.mjs from a trusted local revision
# in the benchmark browser, keeping all other inputs fixed.
node scripts/benchmark-pc-live.mjs       # end-to-end cadence; optional argument: path to a PC zip
```

The timing harnesses accept `CHROMIUM_PATH` for an existing Chromium executable. Set `BENCH_INTERVALS=4` for the PC run above. For real acceptance testing, check representative occupied **and** vacant views from the intended cameras, including seated/distant people and night lighting; treat weak/obstructed views as uncertain rather than relying on an empty label.
