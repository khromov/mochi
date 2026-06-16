// A single changelog item scene: eyebrow + display title + italic blurb + a visual slot.
// Mirrors the Layer/centering pattern from scenes.tsx, but square-canvas sized and reusable.
import type { ReactNode } from 'react';
import { COLORS } from '../theme';
import { CANVAS_SQUARE } from '../theme';
import { clamp, lerp, norm, easeOutCubic } from '../anim';
import { Box, fontDisplay, fontSerifItalic, fontMono } from '../ui';

// Absolutely-positioned, centered, full-square layer (drives the scene cross-fade via opacity).
export const Layer = ({ opacity, children }: { opacity: number; children: ReactNode }) => (
  <Box
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: CANVAS_SQUARE.width,
      height: CANVAS_SQUARE.height,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 130,
      opacity,
    }}
  >
    {children}
  </Box>
);

export const ChangelogScene = ({
  opacity,
  t,
  eyebrow,
  title,
  blurb,
  children,
}: {
  opacity: number;
  // Seconds since this scene started — drives the staggered entrance of title/blurb/visual.
  t: number;
  eyebrow?: string;
  title: string;
  blurb?: string;
  children?: ReactNode;
}) => {
  const titleP = clamp(norm(t, 0.15, 1.1));
  const blurbP = clamp(norm(t, 0.5, 1.5));
  return (
    <Layer opacity={opacity}>
      {eyebrow ? (
        <Box
          style={{
            ...fontMono,
            fontSize: 42,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: COLORS.textOnHeroSubtle,
            marginBottom: 36,
            opacity: clamp(norm(t, 0, 0.9)),
          }}
        >
          {eyebrow}
        </Box>
      ) : null}
      <Box
        style={{
          ...fontDisplay,
          fontSize: 176,
          color: COLORS.textOnHero,
          letterSpacing: '-0.018em',
          lineHeight: 1.04,
          textAlign: 'center',
          opacity: titleP,
          transform: `translateY(${lerp(40, 0, easeOutCubic(titleP))}px)`,
        }}
      >
        {title}
      </Box>
      {blurb ? (
        <Box style={{ ...fontSerifItalic, fontSize: 66, color: COLORS.textOnHeroMuted, textAlign: 'center', maxWidth: 1820, marginTop: 40, opacity: blurbP }}>{blurb}</Box>
      ) : null}
      {children ? <Box style={{ marginTop: 76, flexDirection: 'column', alignItems: 'center' }}>{children}</Box> : null}
    </Layer>
  );
};
