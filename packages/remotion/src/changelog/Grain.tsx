// A tasteful film-grain overlay for changelog videos. Same fractal-noise recipe as Background's
// built-in grain, but a touch more present and with its own filter id so the two don't collide.
// Static (no per-frame seed) so it compresses cleanly and never flickers. Rendered above the
// gradient/leaves but below the text, so it textures the backdrop without muddying the type.
import { AbsoluteFill } from 'remotion';

export const Grain = ({ opacity = 0.1 }: { opacity?: number }) => (
  <AbsoluteFill style={{ mixBlendMode: 'overlay' }}>
    <svg width="100%" height="100%">
      <filter id="changelog-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" result="n" />
        <feColorMatrix in="n" type="saturate" values="0" result="m" />
        <feComponentTransfer in="m">
          <feFuncA type="linear" slope={opacity} />
        </feComponentTransfer>
      </filter>
      <rect width="100%" height="100%" filter="url(#changelog-grain)" />
    </svg>
  </AbsoluteFill>
);
