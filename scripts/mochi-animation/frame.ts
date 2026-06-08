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
    // wooden skewer poking out the top
    h({
      position: 'absolute',
      left: ball / 2 - stickW / 2,
      top: -ball * 0.55,
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
  const enter = easeOutBack(clamp(norm(t, 0.1, 1.4)));
  const wordY = lerp(34, 0, easeOutCubic(clamp(norm(t, 0.5, 1.7))));
  const wordOp = clamp(norm(t, 0.5, 1.5));
  return layer(op, [
    h({ transform: `scale(${0.72 + 0.28 * enter})`, transformOrigin: '50% 50%', marginBottom: 18 }, dango(96)),
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
    h({ marginBottom: 16, transform: `scale(${lerp(0.85, 1, enter)})`, transformOrigin: '50% 50%' }, dango(78)),
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
      children: [...scenes, progressBar(t)],
    },
  };
}
