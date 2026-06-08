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

The local `ffmpeg` is built without `libfreetype`, so text can't be drawn by ffmpeg — it's rendered upstream by satori/resvg instead. ffmpeg only assembles frames.

## Look & feel

Tokens in `src/theme.ts` are lifted from `packages/site/src/shell.html` and `Site.svelte`:
hero gradient `#2b3d33 → #4a7c59`, accent green `#4a7c59`, **Fraunces** display/serif + **JetBrains Mono**.
The 🍡 mascot is drawn as a vector dango (`dango()` in `src/frame.ts`) so it stays offline and animatable.

Fonts are re-instanced from the Fraunces variable font with the brand axes pinned
(`opsz 144 / SOFT 50 / WONK 1` for display) over a full ASCII charset — see `src/prepare-fonts.ts`
(mirrors `packages/site/scripts/instance-fraunces.ts` on the `og-rendering` branch).
The generated `src/fonts/*.otf` are committed so the animation builds without the instancing step.

## Scenes

| time   | scene                              |
| ------ | ---------------------------------- |
| 0–6s   | logo reveal (dango + "mochi")      |
| 6–11s  | "Render everything on the server." |
| 11–19s | islands / selective hydration grid |
| 19–25s | capability chips                   |
| 25–30s | close (mochi.fast)                 |

Output lands in `packages/video-animations/out/` (gitignored).
