// Builds the satori markup for a single frame at time `t` (seconds).
// Each scene is an absolutely-positioned full-canvas layer whose opacity is driven
// by windowOpacity(), so scenes cross-fade on one continuous timeline.
import { COLORS, RADIUS, FONT, CANVAS } from './theme';
import { clamp, lerp, norm, easeOutCubic, easeOutBack, windowOpacity } from './anim';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const h = (style: Record<string, any>, children?: Node): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, ...(children !== undefined ? { children } : {}) },
});

const text = (content: string, style: Record<string, any>): Node => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: content },
});

// Deterministic hash in 0..1 — frames must be reproducible across render workers, so no Math.random().
const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---- Ambient background: soft white leaves that bloom in and out for continuous gentle motion ----
const LEAF_COUNT = 18;

// One leaf: every property is a continuous function of `t`, so motion is smooth frame to
// frame. A steady downward drift is the dominant motion; a small flutter sway and slow
// rotation ride on top. Opacity is tied to vertical position so leaves fade in at the top
// edge and out at the bottom — never pulsing mid-screen. Per-leaf seeds and phases keep the
// field varied and several leaves visible at any moment.
function leaf(i: number, t: number): Node {
  const seed = i + 1;
  const size = lerp(30, 84, rand(seed));

  // Steady descent that wraps through a span taller than the canvas, so the jump back to
  // the top always lands off-screen and never reads as a flicker. Fast enough that the fall
  // is clearly the leading motion within the clip (1200–2400px over 30s).
  const span = CANVAS.height + size * 2;
  const fall = lerp(40, 80, rand(seed + 1.1));
  const yRaw = (rand(seed + 2.2) * span + t * fall) % span;
  const y = yRaw - size;

  // Gentle flutter, kept small relative to the fall so the path reads as a coherent drift.
  const x = rand(seed + 3.3) * CANVAS.width + Math.sin(t * lerp(0.25, 0.5, rand(seed + 4.4)) + seed) * lerp(12, 28, rand(seed + 5.5));
  const rot = lerp(0, 360, rand(seed + 6.6)) + t * lerp(-6, 6, rand(seed + 7.7));

  // Hold a constant soft peak across the screen, fading only within a band of each off-screen
  // edge so leaves enter and leave without any in-place opacity pulse.
  const peak = lerp(0.06, 0.12, rand(seed + 8.8));
  const fadeBand = size * 2;
  const op = peak * Math.min(clamp(yRaw / fadeBand), clamp((span - yRaw) / fadeBand));

  // Classic leaf/petal: two opposite corners fully rounded, the other two sharp.
  return h({
    position: 'absolute',
    left: x,
    top: y,
    width: size,
    height: size,
    background: 'white',
    opacity: op,
    borderTopLeftRadius: size,
    borderBottomRightRadius: size,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    transform: `rotate(${rot}deg)`,
  });
}

function backgroundLeaves(t: number): Node {
  const leaves: Node[] = [];
  for (let i = 0; i < LEAF_COUNT; i++) {
    leaves.push(leaf(i, t));
  }
  return h({ position: 'absolute', top: 0, left: 0, width: CANVAS.width, height: CANVAS.height, overflow: 'hidden' }, leaves);
}

// ---- Mochi dango mascot (three soft balls on a skewer) ----
function dango(ball: number): Node {
  const stickW = ball * 0.16;
  const gap = ball * 0.06;
  const totalH = ball * 3 + gap * 2;
  const ballColors = ['#f3b9c7', '#fff6ea', COLORS.accentSoft]; // sakura / shiro / matcha
  const balls = ballColors.map((c, i) =>
    h({
      position: 'absolute',
      left: 0,
      top: i * (ball + gap),
      width: ball,
      height: ball,
      borderRadius: RADIUS.pill,
      background: c,
      boxShadow: `inset ${ball * 0.12}px ${ball * 0.12}px ${ball * 0.3}px rgba(255,255,255,0.55), inset -${ball * 0.1}px -${ball * 0.12}px ${ball * 0.28}px rgba(0,0,0,0.12)`,
    }),
  );
  return h({ position: 'relative', width: ball, height: totalH, alignItems: 'center', justifyContent: 'center' }, [
    // wooden skewer poking out the bottom (you hold it by the stick)
    h({
      position: 'absolute',
      left: ball / 2 - stickW / 2,
      top: 0,
      width: stickW,
      height: totalH + ball * 0.55,
      borderRadius: RADIUS.pill,
      background: '#d8c39c',
    }),
    ...balls,
  ]);
}

// ---- Scene 1: logo reveal ----
function sceneLogo(t: number): Node {
  const op = windowOpacity(t, 0, 6.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const dangoOp = clamp(norm(t, 0.15, 1.2));
  const wordY = lerp(34, 0, easeOutCubic(clamp(norm(t, 0.5, 1.7))));
  const wordOp = clamp(norm(t, 0.5, 1.5));
  return layer(op, [
    h({ opacity: dangoOp, marginBottom: 18 }, dango(96)),
    text('mochi', {
      fontFamily: FONT.display,
      fontSize: 168,
      color: COLORS.textOnHero,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      opacity: wordOp,
      transform: `translateY(${wordY}px)`,
    }),
    text('an experimental SSR framework', {
      fontFamily: FONT.mono,
      fontSize: 30,
      letterSpacing: '0.32em',
      textTransform: 'uppercase',
      color: COLORS.textOnHeroSubtle,
      marginTop: 26,
      opacity: clamp(norm(t, 1.4, 2.4)),
    }),
  ]);
}

// ---- Scene 2: tagline ----
function sceneTagline(t: number): Node {
  const op = windowOpacity(t, 5.6, 11.6, 0.7);
  if (op <= 0) {
    return null;
  }
  const l1 = clamp(norm(t, 5.9, 6.9));
  const l2 = clamp(norm(t, 6.4, 7.6));
  return layer(op, [
    text('Render everything', {
      fontFamily: FONT.display,
      fontSize: 132,
      color: COLORS.textOnHero,
      letterSpacing: '-0.018em',
      lineHeight: 1.05,
      opacity: l1,
      transform: `translateY(${lerp(40, 0, easeOutCubic(l1))}px)`,
    }),
    text('on the server.', {
      fontFamily: FONT.display,
      fontSize: 132,
      color: COLORS.accentGlow,
      letterSpacing: '-0.018em',
      lineHeight: 1.1,
      opacity: l2,
      transform: `translateY(${lerp(40, 0, easeOutCubic(l2))}px)`,
    }),
    text('Svelte 5 + Bun, server-side on every request.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 40,
      color: COLORS.textOnHeroMuted,
      marginTop: 34,
      opacity: clamp(norm(t, 7.4, 8.6)),
    }),
  ]);
}

// ---- Scene 3: islands / selective hydration ----
function sceneIslands(t: number): Node {
  const op = windowOpacity(t, 11.2, 19.4, 0.7);
  if (op <= 0) {
    return null;
  }
  const cols = 6;
  const rows = 3;
  const count = cols * rows;
  // Pseudo-random but fixed order in which cards "hydrate".
  const order = [7, 2, 13, 9, 4, 16, 11];
  const p = clamp(norm(t, 12.2, 17.6));
  const hydratedN = Math.floor(p * order.length + 0.001);
  const hydrated = new Set(order.slice(0, hydratedN));

  const cards: Node[] = [];
  for (let i = 0; i < count; i++) {
    const on = hydrated.has(i);
    cards.push(
      h(
        {
          width: 150,
          height: 96,
          margin: 10,
          borderRadius: RADIUS.md,
          border: `1px solid ${on ? COLORS.cardHydratedBorder : COLORS.cardIdleBorder}`,
          background: on ? 'rgba(162, 207, 177, 0.16)' : COLORS.cardIdle,
          boxShadow: on ? `0 0 0 1px rgba(162,207,177,0.4), 0 8px 30px rgba(162,207,177,0.25)` : 'none',
          position: 'relative',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          padding: 12,
        },
        [
          // little "lines of content" bars
          h({ width: '70%', height: 8, borderRadius: 4, background: on ? 'rgba(231,241,232,0.85)' : 'rgba(231,241,232,0.22)' }),
          on
            ? h({
                position: 'absolute',
                top: 10,
                right: 10,
                width: 14,
                height: 14,
                borderRadius: RADIUS.pill,
                background: COLORS.accentGlow,
                boxShadow: '0 0 12px rgba(162,207,177,0.9)',
              })
            : h({ position: 'absolute', top: 10, right: 10, width: 14, height: 14, borderRadius: RADIUS.pill, border: '1px solid rgba(231,241,232,0.18)' }),
        ],
      ),
    );
  }

  return layer(op, [
    text('selective hydration', {
      fontFamily: FONT.mono,
      fontSize: 24,
      letterSpacing: '0.34em',
      textTransform: 'uppercase',
      color: COLORS.textOnHeroSubtle,
      marginBottom: 30,
      opacity: clamp(norm(t, 11.5, 12.4)),
    }),
    h({ width: cols * 170, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }, cards),
    text('Ship JavaScript only where it earns its place.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 42,
      color: COLORS.textOnHeroMuted,
      marginTop: 36,
      opacity: clamp(norm(t, 13.0, 14.2)),
    }),
  ]);
}

// ---- Scene 4: capabilities ----
function sceneCaps(t: number): Node {
  const op = windowOpacity(t, 19.0, 25.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const chips = ['SSR', 'Islands', 'Forms', 'WebSockets', 'SSE', 'Bun'];
  const chipNodes = chips.map((label, i) => {
    const a = clamp(norm(t, 20.0 + i * 0.28, 20.7 + i * 0.28));
    return h(
      {
        margin: 12,
        paddingLeft: 38,
        paddingRight: 38,
        paddingTop: 20,
        paddingBottom: 20,
        borderRadius: RADIUS.pill,
        background: COLORS.badgeBg,
        border: `1px solid ${COLORS.badgeBorder}`,
        opacity: a,
        transform: `translateY(${lerp(26, 0, easeOutBack(a))}px) scale(${lerp(0.9, 1, a)})`,
        transformOrigin: '50% 50%',
      },
      text(label, { fontFamily: FONT.serif, fontSize: 48, color: COLORS.badgeText, letterSpacing: '-0.005em' }),
    );
  });
  return layer(op, [
    text('Batteries included.', {
      fontFamily: FONT.display,
      fontSize: 104,
      color: COLORS.textOnHero,
      letterSpacing: '-0.018em',
      marginBottom: 40,
      opacity: clamp(norm(t, 19.3, 20.2)),
      transform: `translateY(${lerp(30, 0, easeOutCubic(clamp(norm(t, 19.3, 20.4))))}px)`,
    }),
    h({ width: 1240, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }, chipNodes),
  ]);
}

// ---- Scene 5: close ----
function sceneClose(t: number): Node {
  const op = windowOpacity(t, 24.6, 30.0, 0.8);
  if (op <= 0) {
    return null;
  }
  const enter = easeOutCubic(clamp(norm(t, 24.9, 26.0)));
  return layer(op, [
    h({ marginBottom: 16, opacity: enter }, dango(78)),
    text('mochi', {
      fontFamily: FONT.display,
      fontSize: 148,
      color: COLORS.textOnHero,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      opacity: enter,
    }),
    text('mochi.fast', {
      fontFamily: FONT.mono,
      fontSize: 32,
      letterSpacing: '0.18em',
      color: COLORS.accentGlow,
      marginTop: 22,
      opacity: clamp(norm(t, 25.6, 26.6)),
    }),
    text('Early prototype — use in production if you are brave.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 30,
      color: COLORS.textOnHeroSubtle,
      marginTop: 30,
      opacity: clamp(norm(t, 26.4, 27.6)),
    }),
  ]);
}

// Absolutely-positioned centered full-canvas layer.
function layer(opacity: number, children: Node[]): Node {
  return h(
    {
      position: 'absolute',
      top: 0,
      left: 0,
      width: CANVAS.width,
      height: CANVAS.height,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      opacity,
    },
    children,
  );
}

// Thin bottom progress bar in accent — a small nod that this is a timed piece.
function progressBar(t: number): Node {
  const frac = clamp(t / 30);
  return h({
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: CANVAS.width * frac,
    height: 6,
    background: COLORS.accentGlow,
    opacity: 0.55,
  });
}

export function buildFrame(t: number): Node {
  const scenes = [sceneLogo(t), sceneTagline(t), sceneIslands(t), sceneCaps(t), sceneClose(t)].filter(Boolean);
  return {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        display: 'flex',
        backgroundImage: `linear-gradient(135deg, ${COLORS.heroFrom} 0%, ${COLORS.heroTo} 100%)`,
        overflow: 'hidden',
      },
      children: [backgroundLeaves(t), ...scenes, progressBar(t)],
    },
  };
}
