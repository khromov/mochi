// The Mochi brand video, ported from the satori frame.ts → buildFrame(t). Every visual
// property is a pure function of `t` (seconds), which here is just frame / fps.
import { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFonts } from './fonts';
import { DURATION_S } from './theme';
import { Background } from './Background';
import { Leaves } from './Leaves';
import { ProgressBar, SceneCaps, SceneClose, SceneIslands, SceneLogo, SceneTagline } from './scenes';

const AUDIO_FADE_S = 3;

export const MochiVideo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Block rasterisation until the brand fonts are decoded (otherwise frames flash the fallback).
  const [fontHandle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    loadFonts().finally(() => continueRender(fontHandle));
  }, [fontHandle]);
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Background />
      <Leaves t={t} />
      <SceneLogo t={t} />
      <SceneTagline t={t} />
      <SceneIslands t={t} />
      <SceneCaps t={t} />
      <SceneClose t={t} />
      <ProgressBar t={t} />
      {/* Fade the soundtrack out over the final stretch (mirrors the old ffmpeg afade). */}
      <Audio
        src={staticFile('audio/bounce-bay-records-traditional-japanese-2-437931.mp3')}
        volume={(f) => interpolate(f, [(DURATION_S - AUDIO_FADE_S) * fps, DURATION_S * fps], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
      />
    </AbsoluteFill>
  );
};
