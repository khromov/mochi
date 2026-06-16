// Reusable visualization primitives the changelog-video skill composes into per-item Visuals.
// Each takes `t` (seconds since the scene started) so motion is a pure function of time.
// When an item needs something not covered here, add a new primitive or a bespoke component.
import { COLORS, RADIUS } from '../../theme';
import { clamp, lerp, norm, easeOutCubic, easeOutBack } from '../../anim';
import { Box, fontDisplay, fontMono, fontSerif } from '../../ui';

// Pill badges that pop in one after another (the SceneCaps feel).
export const BadgeRow = ({ t, labels }: { t: number; labels: string[] }) => (
  <Box style={{ maxWidth: 1500, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
    {labels.map((label, i) => {
      const a = clamp(norm(t, 0.2 + i * 0.18, 0.9 + i * 0.18));
      return (
        <Box
          key={label}
          style={{
            margin: 14,
            paddingLeft: 40,
            paddingRight: 40,
            paddingTop: 22,
            paddingBottom: 22,
            borderRadius: RADIUS.pill,
            background: COLORS.badgeBg,
            border: `1px solid ${COLORS.badgeBorder}`,
            opacity: a,
            transform: `translateY(${lerp(26, 0, easeOutBack(a))}px) scale(${lerp(0.9, 1, a)})`,
            transformOrigin: '50% 50%',
          }}
        >
          <Box style={{ ...fontSerif, fontSize: 52, color: COLORS.badgeText }}>{label}</Box>
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
        fontSize: 44,
        color: COLORS.badgeText,
        paddingLeft: 44,
        paddingRight: 44,
        paddingTop: 26,
        paddingBottom: 26,
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

// A big count-up number with a caption — for "10× faster", "3 new APIs", etc.
export const Stat = ({ t, value, suffix = '', label }: { t: number; value: number; suffix?: string; label: string }) => {
  const p = easeOutCubic(clamp(norm(t, 0.2, 1.6)));
  const shown = Math.round(value * p);
  return (
    <Box style={{ flexDirection: 'column', alignItems: 'center', opacity: clamp(norm(t, 0.1, 0.6)) }}>
      <Box style={{ ...fontDisplay, fontSize: 220, lineHeight: 1, color: COLORS.accentGlow, letterSpacing: '-0.02em' }}>
        {shown}
        {suffix}
      </Box>
      <Box style={{ ...fontMono, fontSize: 30, letterSpacing: '0.28em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 18 }}>{label}</Box>
    </Box>
  );
};
