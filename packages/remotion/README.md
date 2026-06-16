# mochi-remotion

The Mochi brand animation rendered with [Remotion](https://remotion.dev) (React + headless Chrome). A port of the original satori-based video pipeline, reproducing the same 30s piece: hero gradient with monochrome grain, drifting leaves, the dango mascot, five cross-faded scenes, a bottom progress bar, and a soundtrack with a 3s fade-out.

**Output:** `out/mochi.mp4` — 1920×1080, 30 fps, 30s.

## Commands

```sh
bun run studio    # Remotion Studio preview (scrub the timeline)
bun run render    # render out/mochi.mp4 (H.264, yuv420p, crf 18)
bun run typecheck
bun run clean     # remove out/
```

The first render downloads a Chrome Headless Shell.

## How it works

- **`src/MochiVideo.tsx`** — the composition. `t = useCurrentFrame() / fps`; every visual property is a pure function of `t`, mirroring the old `buildFrame(t)`.
- **`src/anim.ts`** — easing/interpolation kit (copied verbatim from the satori version) driving all motion on one continuous timeline.
- **`src/scenes.tsx`** — the five scenes, each gated by `windowOpacity(t, …)` so they cross-fade.
- **`src/Background.tsx`** — gradient + grain (the `feTurbulence` filter from the original, blended in `overlay`).
- **`src/Leaves.tsx`** / **`src/Dango.tsx`** — the ambient leaf field and mascot.
- **`src/fonts.ts`** — variable Fraunces (normal + italic) and JetBrains Mono, with axis cuts applied live via `font-variation-settings`; a `delayRender` guard waits for the fonts before rasterising.
