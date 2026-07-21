// The reusable changelog composition. Renders the green shell, then the intro, each item
// scene, and the outro on one cross-faded timeline (computeTimeline). Square 4K, silent —
// no Audio, no progress bar. Drive it with a release data module (see releases/).
import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import { loadFonts } from '../fonts';
import { windowOpacity } from '../anim';
import { ChangelogShell } from './ChangelogShell';
import { ChangelogScene } from './ChangelogScene';
import { IntroScene } from './IntroScene';
import { OutroScene } from './OutroScene';
import { DemoFrame } from './DemoFrame';
import { computeTimeline, FADE } from './timeline';
import type { ChangelogRelease } from './types';

export const ChangelogVideo = ({ release }: { release: ChangelogRelease }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const tl = computeTimeline(release);

  // Block rasterisation until the brand fonts are decoded (same pattern as MochiVideo).
  const [fontHandle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    loadFonts().finally(() => continueRender(fontHandle));
  }, [fontHandle]);

  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {release.audio ? (
        <Audio
          src={staticFile(release.audio)}
          volume={(f) => interpolate(f, [0, fps, durationInFrames - fps, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      ) : null}

      <ChangelogShell t={t} />

      <IntroScene opacity={windowOpacity(t, tl.intro.start, tl.intro.end, FADE)} t={t - tl.intro.start} title={release.title} version={release.version} />

      {release.items.map((item, i) => {
        const w = tl.items[i];
        if (!w) {
          return null;
        }
        const op = windowOpacity(t, w.start, w.end, FADE);
        const localT = t - w.start;
        return (
          <ChangelogScene key={item.id} opacity={op} t={localT} eyebrow={`What's new · ${i + 1}/${release.items.length}`} title={item.title} blurb={item.blurb}>
            {item.Visual ? <item.Visual t={localT} p={Math.max(0, Math.min(1, localT / (w.end - w.start)))} /> : null}
            {item.showDemo && release.demo ? <DemoFrame src={release.demo.src} label={release.demo.label} startFrame={Math.round(w.start * fps)} /> : null}
          </ChangelogScene>
        );
      })}

      <OutroScene opacity={windowOpacity(t, tl.outro.start, tl.outro.end, FADE)} t={t - tl.outro.start} />
    </AbsoluteFill>
  );
};
