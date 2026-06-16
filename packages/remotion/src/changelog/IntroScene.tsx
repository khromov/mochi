// Opening title card: Dango + "mochi" wordmark + the release title/version. Reuses the brand
// reveal feel from SceneLogo (dango fade-in, wordmark slide-up).
import { COLORS } from '../theme';
import { clamp, lerp, norm, easeOutCubic } from '../anim';
import { Box, fontDisplay, fontMono } from '../ui';
import { Dango } from '../Dango';
import { Layer } from './ChangelogScene';

export const IntroScene = ({ opacity, t, title, version }: { opacity: number; t: number; title: string; version: string }) => {
  const dangoOp = clamp(norm(t, 0.15, 1.2));
  const wordY = lerp(40, 0, easeOutCubic(clamp(norm(t, 0.5, 1.7))));
  const wordOp = clamp(norm(t, 0.5, 1.5));
  return (
    <Layer opacity={opacity}>
      <Box style={{ opacity: dangoOp, marginBottom: 22 }}>
        <Dango ball={110} />
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 150, color: COLORS.textOnHero, letterSpacing: '-0.02em', lineHeight: 1, opacity: wordOp, transform: `translateY(${wordY}px)` }}>
        mochi
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 64, color: COLORS.accentGlow, letterSpacing: '-0.01em', marginTop: 24, textAlign: 'center', opacity: clamp(norm(t, 1.1, 2.0)) }}>
        {title}
      </Box>
      <Box
        style={{ ...fontMono, fontSize: 30, letterSpacing: '0.3em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 24, opacity: clamp(norm(t, 1.5, 2.4)) }}
      >
        {version}
      </Box>
    </Layer>
  );
};
