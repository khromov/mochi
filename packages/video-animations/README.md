# mochi-video-animations

Programmatic, 16:9 brand animations for Mochi, rendered to MP4.

```sh
bun run mochi:animate                      # from the repo root, or:
bun --cwd=packages/video-animations run animate
# → packages/video-animations/out/mochi.mp4  (1920×1080, 30 fps, 30s, silent)

bun --cwd=packages/video-animations run probe   # render one PNG per scene to out/probe/
```

## How it works

Each frame is built as **satori** markup (`src/frame.ts`), parametrised by time `t`, then:

1. `satori` lays it out and emits an SVG with text already converted to vector paths.
2. A monochrome `feTurbulence` grain filter is injected over the gradient backdrop (the Mochi hero look).
3. `@resvg/resvg-js` rasterises each SVG → PNG (`out/frames/frame_NNNN.png`).
4. `ffmpeg` encodes the PNG sequence → `out/mochi.mp4` (libx264, yuv420p, crf 18).

### Parallel rendering

Frame rendering (the CPU-bound step) is split across worker threads (`src/render-worker.ts`).
Worker `id` of `N` renders frames `id, id+N, id+2N, …` — a round-robin split so the heavier
scenes (e.g. the island grid) spread evenly across threads. The main thread waits for all workers,
then encodes once. Defaults to 4 workers; override with `VIDEO_WORKERS`:

```sh
VIDEO_WORKERS=8 bun run mochi:animate   # more threads
VIDEO_WORKERS=1 bun run mochi:animate   # single-threaded (inline, no workers)
```

The local `ffmpeg` is built without `libfreetype`, so text can't be drawn by ffmpeg — it's rendered upstream by satori/resvg instead. ffmpeg only assembles frames.

## Look & feel

Tokens in `src/theme.ts` are lifted from `packages/site/src/shell.html` and `Site.svelte`:
hero gradient `#2b3d33 → #4a7c59`, accent green `#4a7c59`, **Fraunces** display/serif + **JetBrains Mono**.
The 🍡 mascot is drawn as a vector dango (`dango()` in `src/frame.ts`) so it stays offline and animatable.

Fonts are re-instanced from the Fraunces variable font with the brand axes pinned
(`opsz 144 / SOFT 50 / WONK 1` for display) over a full ASCII charset — see `src/prepare-fonts.ts`
(mirrors `packages/site/scripts/instance-fraunces.ts` on the `og-rendering` branch).
The source fonts come from the `@fontsource` packages in `node_modules`; the instanced
`.otf` files are generated (not committed) into a gitignored `.fonts/` cache on first run.
`animate`/`probe` call `prepareFonts()` automatically, or run `bun run prepare-fonts` to force a rebuild.

## Scenes

| time   | scene                              |
| ------ | ---------------------------------- |
| 0–6s   | logo reveal (dango + "mochi")      |
| 6–11s  | "Render everything on the server." |
| 11–19s | islands / selective hydration grid |
| 19–25s | capability chips                   |
| 25–30s | close (mochi.fast)                 |

Output lands in `packages/video-animations/out/` (gitignored).
