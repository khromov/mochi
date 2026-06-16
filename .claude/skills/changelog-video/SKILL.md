---
name: changelog-video
description: Generate a reusable, on-brand Remotion changelog video (square 4K, x265, silent, 20-30s) from a release changelog. Use when the user says "make a changelog video", "create a release video", "changelog video", or "/changelog-video". Distinct from mochi-changelog, which writes the text changelog.
user-invocable: true
---

# Changelog video

Turn a release changelog into a short, on-brand promo video. Output is **square 2160×2160, 30fps, x265/HEVC, silent, 20–30s total**. Videos are data-driven: a per-release module feeds the reusable `ChangelogVideo` composition in `packages/remotion`.

## 0. First: load Remotion domain knowledge

Invoke the **`remotion-best-practices`** skill before writing animation code. Non-negotiables from it: animate via `useCurrentFrame()` + `interpolate()` (here: the `anim.ts` helpers / `windowOpacity`); **no CSS transitions/animations, no Tailwind animation classes**; `<Sequence>` for timing (`layout="none"` for inline); `<Video>`/`<Audio>` from `@remotion/media`; `staticFile()` for assets; `remotion still` for a one-frame sanity check.

## 1. Gather inputs from the user

- The changelog **items**: for each, a short **title**, a one-line **blurb**, and a brief note on **how to visualize** it.
- Whether there's a **demo video**, its **file path**, and **which item** it belongs to.
- Reaffirm the fixed constraints: **no music, no sound effects**; total **20–30s**; keep each slide brief.

## 2. Reuse — do not rebuild

Everything lives in `packages/remotion/src/`. The reusable scaffolding is in `changelog/`:

- `changelog/ChangelogShell.tsx` — green gradient + grain + leaves backdrop (square). Always use it.
- `changelog/ChangelogScene.tsx` — centered item scene (eyebrow + title + blurb + visual slot) and the `Layer` helper.
- `changelog/IntroScene.tsx` / `OutroScene.tsx` — branded open/close (Dango + wordmark).
- `changelog/DemoFrame.tsx` — the demo video in the green-shell inset (see §5).
- `changelog/visuals/index.tsx` — reusable visual primitives: `BadgeRow`, `CodeChip`, `Stat`. Compose these first.
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
  introS: 4,
  outroS: 4,
  items: [
    { id: 'feature-x', title: 'Feature X', blurb: 'One short line.', durationS: 4.5, Visual: ({ t }) => <BadgeRow t={t} labels={['a', 'b', 'c']} /> },
    // ...
  ],
};
```

## 4. Register the composition

In `Root.tsx`, point the changelog `<Composition>` at the new release (or add a per-version entry so several coexist in Studio):

```tsx
import { release } from './changelog/releases/v0_5_0';
<Composition
  id="Changelog-v0.5.0"
  component={() => <ChangelogVideo release={release} />}
  durationInFrames={computeTimeline(release).totalFrames}
  fps={FPS}
  width={CANVAS_SQUARE.width}
  height={CANVAS_SQUARE.height}
/>;
```

Do **not** pass the release via `defaultProps` — it contains React components, which Remotion can't serialize. Close over it in the inline `component` instead.

## 5. Demo video (optional)

If the user provides one:

1. Put the file in `packages/remotion/public/` (e.g. `public/demos/<name>.mp4`).
2. In the release, set `demo: { src: 'demos/<name>.mp4', label: '…' }` and mark the owning item with `showDemo: true`.

`DemoFrame` renders it as a **static rounded inset** with an accent-green border + glow on the brand background (the "green shell"), and wraps the `<Video>` in a `<Sequence>` so it plays from its first frame when the demo scene begins. Adjust `width`/`height` props if the source isn't ~16:9.

## 6. Preview, verify, render

- **Studio:** `bun run mochi:studio` (alias for `bun --cwd=packages/remotion run studio`), open the composition — confirm the shell/leaves, cross-fades, total in 20–30s, demo in the green frame, and **no audio**.
- **Stills** (optional sanity check): `bun --cwd=packages/remotion x remotion still src/index.ts <id> out/check.png --scale=0.25 --frame=N`.
- **Final render (x265/HEVC, silent):** CLI `--codec` overrides `remotion.config.ts` (which stays h264 for the brand video); `--muted` drops the audio track Remotion otherwise adds (these videos have no sound):

  ```sh
  bun --cwd=packages/remotion x remotion render src/index.ts <id> out/changelog-<version>.mp4 --codec=h265 --crf=18 --muted
  ```

- Spot-check the output: `ffprobe out/changelog-<version>.mp4` — expect 2160×2160, `hevc`, no audio stream, 20–30s.

## 7. After your changes

Per `CLAUDE.md`, **delegate `bun run format` and `bun run checks` to a sub-agent** (it reports only pass/fail) — never run them in the main context.
