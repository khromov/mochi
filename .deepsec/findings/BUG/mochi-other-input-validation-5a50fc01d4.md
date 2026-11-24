# [BUG] VIDEO_WORKERS is not validated as a positive integer, silently producing a corrupt frame sequence or a single-threaded fallback

**File:** [`packages/video-animations/src/generate.ts`](https://github.com/khromov/mochi/blob/main/packages/video-animations/src/generate.ts#L15-L120) (lines 15, 42, 62, 120)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-input-validation`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`WORKERS = Math.max(1, Number(process.env.VIDEO_WORKERS ?? 4))` (L15) accepts any numeric value, and the value is used for two independent purposes that require a positive integer: the worker-pool size (`Array.from({ length: WORKERS }, …)`, L42) and the stride of the frame partition (`worker.postMessage({ workers: WORKERS, … })`, L62, consumed as `for (let i = id; i < total; i += workers)` in render-worker.ts L23).

Three concrete misbehaviours:

1. **Fractional value → silently corrupt mp4.** `VIDEO_WORKERS=2.5` passes `WORKERS > 1` (L120) and enters `renderParallel()`. `Array.from({ length: 2.5 })` applies ToLength and yields only 2 workers (ids 0, 1), but each receives `workers: 2.5` as its stride. Worker 0 then renders frame indices 0, 2.5, 5, 7.5… and worker 1 renders 1, 3.5, 6, 8.5…, so (a) non-integer indices are written as `frame_02.5.png` (`String(2.5).padStart(4, '0')`, render-worker.ts L25) and (b) most integer frames are never written at all. `encode()` feeds ffmpeg the `frame_%04d.png` image2 sequence (L78), which starts at `frame_0000.png` and stops at the first gap — so ffmpeg exits 0 and writes an mp4 containing roughly two frames. No error is raised anywhere; `out/mochi.mp4` is simply wrong.

2. **Non-numeric value → silent 30x slowdown.** `VIDEO_WORKERS=auto` gives `Number('auto') = NaN`; `Math.max(1, NaN)` is `NaN`, `NaN > 1` is false, so it falls through to the single-threaded `renderInline()` while logging `across NaN worker`.

3. **Empty value → 1 worker, not the default 4.** `?? 4` only catches undefined/null, so `VIDEO_WORKERS=` yields `Number('') = 0 → 1`, i.e. the single-threaded path rather than the intended default.

Additionally the value is unbounded on the high side, so a typo like `VIDEO_WORKERS=400` spawns 400 workers that each `loadFonts()` four font files into memory.

This is operator-supplied configuration in a local-only dev script (the package is `private: true`, has no importers, and appears in no CI workflow or Dockerfile), so there is no attacker and no security impact — but the fractional case produces silently broken output, which is exactly the class of failure that costs a full 900-frame re-render to discover.

## Recommendation

Parse and validate once at L15, rejecting anything that is not a positive integer rather than coercing it: e.g. `const raw = process.env.VIDEO_WORKERS; const parsed = raw === undefined || raw === '' ? 4 : Number(raw); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) { throw new Error(`VIDEO_WORKERS must be an integer in 1..64, got ${JSON.stringify(raw)}`); } const WORKERS = parsed;`. As defence in depth, have `encode()` assert that `TOTAL_FRAMES` PNGs exist in `FRAMES_DIR` before invoking ffmpeg, so any future partition bug fails loudly instead of yielding a truncated video.

## Revalidation

**Verdict:** true-positive

I verified every mechanical step against the source. generate.ts:15 is `Math.max(1, Number(process.env.VIDEO_WORKERS ?? 4))` with no integer check, and the same value feeds two incompatible consumers: `Array.from({ length: WORKERS }, …)` at L42 (pool size, ToLength-truncated) and `worker.postMessage({ workers: WORKERS, … })` at L62, consumed as `for (let i = id; i < total; i += workers)` in render-worker.ts:23. With 2.5 you get 2 workers striding by 2.5, so render-worker.ts:25 writes `frame_${String(2.5).padStart(4,'0')}.png` → `frame_02.5.png`, and integer frames 2,3,4,7,8,9… are never written; `encode()` feeds ffmpeg the `frame_%04d.png` image2 sequence (L78), which stops at the first gap, so the mp4 is silently truncated and ffmpeg still exits 0. `Number('auto')` is NaN, `Math.max(1, NaN)` is NaN, `NaN > 1` is false, so L120 falls through to the single-threaded `renderInline()` while L119 logs `across NaN worker` (no plural, since `WORKERS > 1` is false) — both confirmed. `VIDEO_WORKERS=` gives `Number('') === 0 → 1`, not the documented default of 4 (README.md:27 documents that default). TOTAL_FRAMES is 900 (theme.ts: FPS 30 × DURATION_S 30), so the re-render cost framing is right. I also confirmed the no-security-impact framing: packages/video-animations is `"private": true`, is reachable only through the root `mochi:animate` script, and appears in no workflow or Dockerfile — the input is operator-supplied, not attacker-supplied. Real defect, correctly scoped, keep BUG. The practical trigger is narrow (nobody types a fractional worker count), so this is a low-value robustness nit rather than a latent failure waiting to happen.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
