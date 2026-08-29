// Closing card, mirroring SceneClose: Dango + wordmark + the mochi.fast handle.
import { COLORS } from '../theme';
import { clamp, norm, easeOutCubic } from '../anim';
import { Box, fontDisplay, fontMono } from '../ui';
import { Dango } from '../Dango';
import { Layer } from './ChangelogScene';

export const OutroScene = ({ opacity, t, tagline = 'mochi.fast' }: { opacity: number; t: number; tagline?: string }) => {
  const enter = easeOutCubic(clamp(norm(t, 0.2, 1.2)));
  return (
    <Layer opacity={opacity}>
      <Box style={{ marginBottom: 36, opacity: enter }}>
        <Dango ball={200} />
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 300, color: COLORS.textOnHero, letterSpacing: '-0.02em', lineHeight: 1, opacity: enter }}>mochi</Box>
      <Box style={{ ...fontMono, fontSize: 168, letterSpacing: '0.02em', color: COLORS.accentGlow, marginTop: 48, opacity: clamp(norm(t, 0.9, 1.8)) }}>{tagline}</Box>
    </Layer>
  );
};
