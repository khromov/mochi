// Hero gradient backdrop with the signature monochrome grain. The grain reproduces
// render.ts:injectNoise() — feTurbulence desaturated to ~5% alpha, blended over the
// gradient in `overlay` mode (here via mix-blend-mode rather than feBlend, keeping the
// CSS 135deg gradient angle exact). Static layer behind everything.
import { AbsoluteFill } from 'remotion';
import { COLORS } from './theme';

export const Background = () => (
  <>
    <AbsoluteFill style={{ backgroundImage: `linear-gradient(135deg, ${COLORS.heroFrom} 0%, ${COLORS.heroTo} 100%)` }} />
    <AbsoluteFill style={{ mixBlendMode: 'overlay' }}>
      <svg width="100%" height="100%">
        <filter id="mochi-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="saturate" values="0" result="m" />
          <feComponentTransfer in="m">
            <feFuncA type="linear" slope="0.05" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter="url(#mochi-grain)" />
      </svg>
    </AbsoluteFill>
  </>
);
