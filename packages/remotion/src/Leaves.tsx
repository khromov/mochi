// Ambient background: 18 soft white leaves drifting down, blooming in/out at the screen
// edges. Ported 1:1 from frame.ts — every property is a continuous function of `t`, so motion
// stays smooth frame to frame. Positioning via transform (not left/top) keeps sub-pixel drift
// smooth, exactly as the original (which did it to dodge satori's integer-pixel rounding).
import { CANVAS } from './theme';
import { clamp, lerp } from './anim';
import { Box } from './ui';

const LEAF_COUNT = 18;

// Deterministic hash in 0..1 — keep the field reproducible (no Math.random()).
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const Leaf = ({ i, t }: { i: number; t: number }) => {
  const seed = i + 1;
  const size = lerp(30, 84, rand(seed));

  // Steady descent wrapping through a span taller than the canvas, so the jump back to the top
  // always lands off-screen and never reads as a flicker (1200–2400px over 30s).
  const span = CANVAS.height + size * 2;
  const fall = lerp(50, 90, rand(seed + 1.1));
  const yRaw = (rand(seed + 2.2) * span + t * fall) % span;
  const y = yRaw - size;

  // Gentle lateral drift, slow and small so the steady fall stays the dominant motion.
  const x = rand(seed + 3.3) * CANVAS.width + Math.sin(t * lerp(0.15, 0.3, rand(seed + 4.4)) + seed) * lerp(10, 22, rand(seed + 5.5));
  // Barely-there rotation; the downward fall carries the motion.
  const rot = lerp(0, 360, rand(seed + 6.6)) + t * lerp(-2, 2, rand(seed + 7.7));

  // Constant soft peak across the screen, fading only within a band of each off-screen edge.
  const peak = lerp(0.06, 0.12, rand(seed + 8.8));
  const fadeBand = size * 2;
  const op = peak * Math.min(clamp(yRaw / fadeBand), clamp((span - yRaw) / fadeBand));

  // Classic leaf/petal: two opposite corners fully rounded, the other two sharp.
  return (
    <Box
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: size,
        height: size,
        background: 'white',
        opacity: op,
        borderTopLeftRadius: size,
        borderBottomRightRadius: size,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 0,
        transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`,
      }}
    />
  );
};

export const Leaves = ({ t }: { t: number }) => (
  <Box style={{ position: 'absolute', top: 0, left: 0, width: CANVAS.width, height: CANVAS.height, overflow: 'hidden' }}>
    {Array.from({ length: LEAF_COUNT }, (_, i) => (
      <Leaf key={i} i={i} t={t} />
    ))}
  </Box>
);
