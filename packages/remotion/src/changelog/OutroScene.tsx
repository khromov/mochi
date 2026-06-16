// Closing card, mirroring SceneClose: Dango + wordmark + the mochi.fast handle.
import { COLORS } from '../theme';
import { clamp, norm, easeOutCubic } from '../anim';
import { Box, fontDisplay, fontMono, fontSerifItalic } from '../ui';
import { Dango } from '../Dango';
import { Layer } from './ChangelogScene';

export const OutroScene = ({ opacity, t, tagline = 'mochi.fast' }: { opacity: number; t: number; tagline?: string }) => {
  const enter = easeOutCubic(clamp(norm(t, 0.2, 1.2)));
  return (
    <Layer opacity={opacity}>
      <Box style={{ marginBottom: 36, opacity: enter }}>
        <Dango ball={200} />
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 330, color: COLORS.textOnHero, letterSpacing: '-0.02em', lineHeight: 1, opacity: enter }}>mochi</Box>
      <Box style={{ ...fontMono, fontSize: 70, letterSpacing: '0.18em', color: COLORS.accentGlow, marginTop: 40, opacity: clamp(norm(t, 0.9, 1.8)) }}>{tagline}</Box>
      <Box style={{ ...fontSerifItalic, fontSize: 64, color: COLORS.textOnHeroSubtle, marginTop: 40, opacity: clamp(norm(t, 1.4, 2.4)) }}>Render everything on the server.</Box>
    </Layer>
  );
};
