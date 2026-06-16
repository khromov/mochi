// The demo video sitting inside the brand "green shell": a rounded inset with an accent-green
// border + soft glow, on a dark inner screen. The video is wrapped in a Sequence (layout="none")
// so it plays from its own first frame when the demo scene begins, regardless of where on the
// timeline that scene falls. Video element comes from @remotion/media per remotion-best-practices.
import { Video } from '@remotion/media';
import { Sequence, staticFile } from 'remotion';
import { COLORS, RADIUS } from '../theme';
import { Box, fontMono } from '../ui';

export const DemoFrame = ({
  src,
  label,
  startFrame,
  width = 1640,
  height = 922,
}: {
  src: string;
  label?: string;
  // Composition frame at which the demo scene starts — the video plays from 0 here.
  startFrame: number;
  width?: number;
  height?: number;
}) => (
  <Box style={{ flexDirection: 'column', alignItems: 'center' }}>
    <Box
      style={{
        padding: 16,
        borderRadius: RADIUS.lg,
        background: COLORS.inkDark,
        border: `2px solid ${COLORS.accentGlow}`,
        boxShadow: '0 0 0 1px rgba(162,207,177,0.4), 0 30px 90px rgba(0,0,0,0.45), 0 0 70px rgba(162,207,177,0.25)',
      }}
    >
      <Sequence from={startFrame} layout="none">
        <Video src={staticFile(src)} style={{ width, height, objectFit: 'contain', borderRadius: RADIUS.md, display: 'block' }} />
      </Sequence>
    </Box>
    {label ? <Box style={{ ...fontMono, fontSize: 38, letterSpacing: '0.18em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 32 }}>{label}</Box> : null}
  </Box>
);
