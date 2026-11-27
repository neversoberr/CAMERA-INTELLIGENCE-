# Person detection: what changed and what was measured

The target decision is **does this camera view contain a visible person?** No identities, remote inference or training on user screens. The comparisons below use actual browser workers, not mocked detections.

## 0.3: Heavy mode and vacancy timing

Heavy (now the default) adds a second, larger EfficientDet-Lite2 int8 detector. On each sampled frame, both Lite0 and Lite2 scan every usable whole camera tile. Lite2 then scans four overlapping close-ups where the tile is large enough, regardless of whether a person was already found. No cached inference or motion trigger in Heavy. Blank/tiny tiles stay **Unclear**. This trades speed for coverage, not an assured increase in accuracy.

| Reference photos | 0.2 Balanced: occupied / empty / unclear | 0.3 Heavy: occupied / empty / unclear |
|---|---:|---:|
| Person present (61) | 58 / 2 / 1 | **58 / 0 / 3** |
| No labelled person (67) | 2 / 65 / 0 | **2 / 56 / 9** |

Same 128 COCO photos and presence criterion as below. Heavy did **not** find more positive photos overall; it made fewer false-empty decisions here, at the cost of more Unclear views. This small, non-CCTV set cannot establish a false-empty rate for a cabin.

On the two-vCPU software-rendered test machine, Heavy's warm 2×2 worker medians were **5.07 s unchanged / 4.82 s changing** (3 samples each, 24 model passes per sweep). Median 1×1 still time was **1.20 s**. Through the actual extracted offline HTML and 4 fps synthetic changing screen, the median interval between completed updates was **6.68 s** (3 warm intervals). These are different measurements, not real-time FPS promises. Larger walls and slower machines can take longer. `SCAN_MODE=heavy BENCH_GRID_RUNS=3` selects this worker run; `SCAN_MODE=heavy BENCH_INTERVALS=3 node scripts/benchmark-pc-live.mjs` selects the PC cadence run.

**Timeline checks:** automated Chromium tests use advancing synthetic screens and real detectors. They exercise a 4×4 Heavy sweep twice with one signal-less view (15 fresh whole-camera pairs each time), a person entering one cabin while a different view loses signal, no new delivered frames, crop changes, stop, export, and reopening the local HTML. A period’s endpoint is the last fresh *empty frame timestamp*, never the detector completion, subsequent arrival or time of reopening. These checks validate the bookkeeping, not accuracy on a particular site.

## 0.2: Balanced compared with the original single pass

Framewatch 0.2 uses the same local COCO EfficientDet-Lite0 weights as 0.1. The change is the inference pipeline: multiple image scales, evidence fusion, bounded reuse and live vacancy confirmation.

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
# to include the labelled presence matrix. Set SCAN_MODE to fast, balanced, detail or heavy.
# Optional BENCH_WORKER_DIR: serve worker.js and analysis.mjs from a trusted local revision
# in the benchmark browser, keeping all other inputs fixed.
node scripts/benchmark-pc-live.mjs       # end-to-end cadence; optional argument: path to a PC zip
```

The timing harnesses accept `CHROMIUM_PATH` for an existing Chromium executable. Set `BENCH_INTERVALS=4` for the PC run above. For real acceptance testing, check representative occupied **and** vacant views from the intended cameras, including seated/distant people and night lighting; treat weak/obstructed views as uncertain rather than relying on an empty label.
