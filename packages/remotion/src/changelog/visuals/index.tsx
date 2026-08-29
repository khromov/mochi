// Reusable visualization primitives the changelog-video skill composes into per-item Visuals.
// Each takes `t` (seconds since the scene started) so motion is a pure function of time.
// When an item needs something not covered here, add a new primitive or a bespoke component.
import { Img, staticFile } from 'remotion';
import { COLORS, RADIUS } from '../../theme';
import { clamp, lerp, norm, easeOutCubic, easeOutBack } from '../../anim';
import { Box, fontDisplay, fontMono, fontSerif } from '../../ui';

// Pill badges that pop in one after another (the SceneCaps feel).
export const BadgeRow = ({ t, labels }: { t: number; labels: string[] }) => (
  <Box style={{ maxWidth: 1860, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
    {labels.map((label, i) => {
      const a = clamp(norm(t, 0.2 + i * 0.18, 0.9 + i * 0.18));
      return (
        <Box
          key={label}
          style={{
            margin: 22,
            paddingLeft: 66,
            paddingRight: 66,
            paddingTop: 40,
            paddingBottom: 40,
            borderRadius: RADIUS.pill,
            background: COLORS.badgeBg,
            border: `1px solid ${COLORS.badgeBorder}`,
            opacity: a,
            transform: `translateY(${lerp(26, 0, easeOutBack(a))}px) scale(${lerp(0.9, 1, a)})`,
            transformOrigin: '50% 50%',
          }}
        >
          <Box style={{ ...fontSerif, fontSize: 100, color: COLORS.badgeText }}>{label}</Box>
        </Box>
      );
    })}
  </Box>
);

// A monospace "code" pill — for showing an API call, flag, or command.
export const CodeChip = ({ t, text }: { t: number; text: string }) => {
  const a = clamp(norm(t, 0.2, 1.1));
  return (
    <Box
      style={{
        ...fontMono,
        fontSize: 86,
        color: COLORS.badgeText,
        paddingLeft: 68,
        paddingRight: 68,
        paddingTop: 44,
        paddingBottom: 44,
        borderRadius: RADIUS.md,
        background: 'rgba(23,25,20,0.55)',
        border: `1px solid ${COLORS.badgeBorder}`,
        opacity: a,
        transform: `translateY(${lerp(24, 0, easeOutCubic(a))}px)`,
      }}
    >
      {text}
    </Box>
  );
};

// A still screenshot sitting in the brand "green shell" — a rounded inset with an accent-green
// border + glow (the DemoFrame look, but for an <Img> instead of a <Video>). For showing a real
// UI capture (e.g. the dev email outbox, the captcha slider). `src` is relative to public/.
export const Screenshot = ({ t, src, width = 1560, height = 877, label }: { t: number; src: string; width?: number; height?: number; label?: string }) => {
  const a = clamp(norm(t, 0.2, 1.1));
  return (
    <Box style={{ flexDirection: 'column', alignItems: 'center', opacity: a, transform: `translateY(${lerp(24, 0, easeOutCubic(a))}px)` }}>
      <Box
        style={{
          padding: 16,
          borderRadius: RADIUS.lg,
          background: COLORS.inkDark,
          border: `2px solid ${COLORS.accentGlow}`,
          boxShadow: '0 0 0 1px rgba(162,207,177,0.4), 0 30px 90px rgba(0,0,0,0.45), 0 0 70px rgba(162,207,177,0.25)',
        }}
      >
        <Img src={staticFile(src)} style={{ width, height, objectFit: 'contain', borderRadius: RADIUS.md, display: 'block' }} />
      </Box>
      {label ? <Box style={{ ...fontMono, fontSize: 72, letterSpacing: '0.16em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 44 }}>{label}</Box> : null}
    </Box>
  );
};

// A big count-up number with a caption — for "10× faster", "3 new APIs", etc.
export const Stat = ({ t, value, suffix = '', label }: { t: number; value: number; suffix?: string; label: string }) => {
  const p = easeOutCubic(clamp(norm(t, 0.2, 1.6)));
  const shown = Math.round(value * p);
  return (
    <Box style={{ flexDirection: 'column', alignItems: 'center', opacity: clamp(norm(t, 0.1, 0.6)) }}>
      <Box style={{ ...fontDisplay, fontSize: 448, lineHeight: 1, color: COLORS.accentGlow, letterSpacing: '-0.02em' }}>
        {shown}
        {suffix}
      </Box>
      <Box style={{ ...fontMono, fontSize: 60, letterSpacing: '0.28em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 28 }}>{label}</Box>
    </Box>
  );
};
