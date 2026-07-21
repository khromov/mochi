---
name: changelog-video
description: Generate a reusable, on-brand Remotion changelog video (square 4K, x264, background music, 20-30s) from a release changelog. Use when the user says "make a changelog video", "create a release video", "changelog video", or "/changelog-video". Distinct from mochi-changelog, which writes the text changelog.
user-invocable: true
---

# Changelog video

Turn a release changelog into a short, on-brand promo video. Output is **square 2160×2160, 30fps, x264/H.264, 20–30s total**, with a **default background music track** (`audio/Perfect_Sequence.mp3`, gently faded in/out). Type sizes are deliberately large so it stays legible on a phone. Videos are data-driven: a per-release module feeds the reusable `ChangelogVideo` composition in `packages/remotion`.

## 0. First: load Remotion domain knowledge

Invoke the **`remotion-best-practices`** skill before writing animation code. Non-negotiables from it: animate via `useCurrentFrame()` + `interpolate()` (here: the `anim.ts` helpers / `windowOpacity`); **no CSS transitions/animations, no Tailwind animation classes**; `<Sequence>` for timing (`layout="none"` for inline); `<Video>`/`<Audio>` from `@remotion/media`; `staticFile()` for assets; `remotion still` for a one-frame sanity check.

## 1. Gather inputs from the user

- The changelog **items**: for each, a short **title**, a one-line **blurb**, and a brief note on **how to visualize** it.
- Whether there's a **demo video**, its **file path**, and **which item** it belongs to.
- Reaffirm the fixed constraints: total **20–30s**; keep each slide brief. A **default background music track** (`audio/Perfect_Sequence.mp3`) plays unless the user asks to drop or swap it — there are **no sound effects**.

## 2. Reuse — do not rebuild

Everything lives in `packages/remotion/src/`. The reusable scaffolding is in `changelog/`:

- `changelog/ChangelogShell.tsx` — green gradient + grain + leaves backdrop (square). Always use it.
- `changelog/ChangelogScene.tsx` — centered item scene (eyebrow + title + blurb + visual slot) and the `Layer` helper.
- `changelog/IntroScene.tsx` / `OutroScene.tsx` — branded open/close (Dango + wordmark).
- `changelog/DemoFrame.tsx` — the demo video in the green-shell inset (see §5).
- `changelog/visuals/index.tsx` — reusable visual primitives: `BadgeRow`, `CodeChip`, `Stat`, `Screenshot`. Compose these first. `Screenshot` shows a still image (`{ t, src, width, height, label? }`) in the green-shell inset — for real UI captures (dev outbox, captcha slider, debug bar); stage the image under `public/images/` and reference it relative to `public/` (e.g. `images/foo.png`). Keep `CodeChip` text to ~35 monospace chars or it wraps to two lines at this font size.
- `changelog/timeline.ts` — `computeTimeline(release)`: scene windows + total frames (single source of truth for duration).
- `changelog/types.ts` — `ChangelogRelease` / `ChangelogItem` / `VisualProps`.
- `changelog/ChangelogVideo.tsx` — the composition; you rarely need to touch it.

Brand primitives reused under the hood: `Background`, `Leaves`, `Dango`, `anim.ts`, `ui.tsx` (`Box`, `fontDisplay/fontSerif/fontSerifItalic/fontMono`), `theme.ts` (`COLORS`, `RADIUS`, `CANVAS_SQUARE`). Use these colors/fonts — never hardcode new ones.

**Build a bespoke per-item Visual only when the requested visualization isn't covered by `visuals/`.** Put new reusable primitives in `visuals/index.tsx`; keep them simple and short. A Visual is a `ComponentType<VisualProps>` (`{ t, p }`, where `t` is seconds since the scene started). Animate purely from `t`/`p` using the `anim.ts` helpers.

## 3. Write the release module

Copy `changelog/releases/sample.tsx` to `changelog/releases/<version>.tsx` and fill it in. Keep blurbs to one line. Pick durations so the total lands in **20–30s**: total ≈ `introS + Σ itemS + outroS − 0.6 × (sceneCount − 1)` (scenes cross-fade by 0.6s). Defaults: intro/outro 3s, item 3.5s. Roughly **4–6 items** fits the window.

```tsx
export const release: ChangelogRelease = {
  version: 'v0.5.0',
  title: 'July release',
  audio: 'audio/Perfect_Sequence.mp3', // default background music; omit to render silent
  introS: 4,
  outroS: 4,
  items: [
    { id: 'feature-x', title: 'Feature X', blurb: 'One short line.', durationS: 4.5, Visual: ({ t }) => <BadgeRow t={t} labels={['a', 'b', 'c']} /> },
    // ...
  ],
};
```

The intro card shows the **version large** (accent green) with the release **title small** below it; the outro shows the wordmark + a large `mochi.fast` handle. `ChangelogVideo` reads `release.audio` and renders an `<Audio>` (from `@remotion/media`) faded in/out over the first/last second — so **omitting `audio` yields a silent video**, and the sample release stays silent.

## 4. Register the composition

In `Root.tsx`, point the changelog `<Composition>` at the new release (or add a per-version entry so several coexist in Studio):

```tsx
import { release } from './changelog/releases/v0_5_0';
<Composition
  id="Changelog-v0-5-0"
  component={() => <ChangelogVideo release={release} />}
  durationInFrames={computeTimeline(release).totalFrames}
  fps={FPS}
  width={CANVAS_SQUARE.width}
  height={CANVAS_SQUARE.height}
/>;
```

**Composition ids may only contain `a-z A-Z 0-9 -` (and CJK) — no dots.** Use dashes for the version: `Changelog-v0-5-0`, not `Changelog-v0.5.0` (which fails the render with "Composition id can only contain …").

Do **not** pass the release via `defaultProps` — it contains React components, which Remotion can't serialize. Close over it in the inline `component` instead.

## 5. Demo video (optional)

If the user provides one:

1. Put the file in `packages/remotion/public/` (e.g. `public/demos/<name>.mp4`).
2. In the release, set `demo: { src: 'demos/<name>.mp4', label: '…' }` and mark the owning item with `showDemo: true`.

`DemoFrame` renders it as a **static rounded inset** with an accent-green border + glow on the brand background (the "green shell"), and wraps the `<Video>` in a `<Sequence>` so it plays from its first frame when the demo scene begins. Adjust `width`/`height` props if the source isn't ~16:9.

## 6. Preview, verify, render

- **Studio:** `bun run mochi:studio` (alias for `bun --cwd=packages/remotion run studio`), open the composition — confirm the shell/leaves, cross-fades, total in 20–30s, demo in the green frame, and the **music track plays**.
- **Stills** (optional sanity check): `cd packages/remotion && bun x remotion still src/index.ts <id> out/check.png --scale=0.25 --frame=N`. (Invoke from inside `packages/remotion`; the `--cwd=… x remotion still` form mangles the args.)
- **Final render (x264/H.264, with music):** do **not** pass `--muted` when the release sets `audio` — that would strip the track. h264 is the project default in `remotion.config.ts`, so no `--codec` flag is needed:

  ```sh
  cd packages/remotion && bun x remotion render src/index.ts <id> out/changelog-<version>.mp4 --crf=18
  ```

  (Only add `--muted` for a release that deliberately omits `audio`.)

- Spot-check the output: `ffprobe out/changelog-<version>.mp4` — expect 2160×2160, `h264`, an `aac` audio stream, 20–30s.

## 7. After your changes

Per `CLAUDE.md`, **delegate `bun run format` and `bun run checks` to a sub-agent** (it reports only pass/fail) — never run them in the main context.
