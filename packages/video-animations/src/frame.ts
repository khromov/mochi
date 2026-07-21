// Builds the satori markup for a single frame at time `t` (seconds).
// Each scene is an absolutely-positioned full-canvas layer whose opacity is driven
// by windowOpacity(), so scenes cross-fade on one continuous timeline.
// Content showcases the Mochi 0.8.0 release (see packages/site/src/blog/2026-07-21-mochi-0-8-0.md).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLORS, RADIUS, FONT, CANVAS, DURATION_S } from './theme';
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

// Satori renders <img> natively when given explicit width/height and a data-URI src.
const img = (src: string, w: number, height: number, style: Record<string, any> = {}): Node => ({
  type: 'img',
  props: { src, width: w, height, style: { display: 'flex', ...style } },
});

// The two real blog screenshots, embedded as base64 data URIs. Read once per worker at import.
function screenshotDataUri(name: string): string {
  const abs = resolve(import.meta.dir, '..', '..', 'docs', 'images', name);
  return `data:image/png;base64,${readFileSync(abs).toString('base64')}`;
}
const IMG_EMAIL = screenshotDataUri('email-outbox.png'); // 1400 x 787
const IMG_DEBUGBAR = screenshotDataUri('debug-bar.png'); // 1036 x 72

// The alert red used by the site's rate-limit demo (PostRateLimitDemo.svelte); no green-family equivalent.
const ERROR_RED = '#d9534f';

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
  // the top always lands off-screen and never reads as a flicker.
  const span = CANVAS.height + size * 2;
  const fall = lerp(50, 90, rand(seed + 1.1));
  const yRaw = (rand(seed + 2.2) * span + t * fall) % span;
  const y = yRaw - size;

  // Gentle lateral drift, slow and small so the steady fall stays clearly the dominant motion.
  const x = rand(seed + 3.3) * CANVAS.width + Math.sin(t * lerp(0.15, 0.3, rand(seed + 4.4)) + seed) * lerp(10, 22, rand(seed + 5.5));
  // Each leaf holds a near-fixed orientation: a spinning asymmetric petal reads as wobble.
  const rot = lerp(0, 360, rand(seed + 6.6)) + t * lerp(-2, 2, rand(seed + 7.7));

  // Hold a constant soft peak across the screen, fading only within a band of each off-screen edge.
  const peak = lerp(0.06, 0.12, rand(seed + 8.8));
  const fadeBand = size * 2;
  const op = peak * Math.min(clamp(yRaw / fadeBand), clamp((span - yRaw) / fadeBand));

  // Classic leaf/petal: two opposite corners fully rounded, the other two sharp.
  // Position via transform, not left/top: satori rounds layout positions to the integer pixel
  // grid, which turns sub-pixel-per-frame drift into a visible stair-step jitter. A transform
  // matrix is applied after layout at full float precision, so motion stays smooth.
  return h({
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

// ---- Small shared building blocks ----

// Uppercase, wide-tracked mono section label above a scene's content.
function sectionLabel(content: string, opacity: number, marginBottom = 30): Node {
  return text(content, {
    fontFamily: FONT.mono,
    fontSize: 26,
    letterSpacing: '0.34em',
    textTransform: 'uppercase',
    color: COLORS.textOnHeroSubtle,
    marginBottom,
    opacity,
  });
}

// A single line of code on a dark rounded block (inkDark = rgb(23,25,20)).
function codePill(content: string, opacity: number, marginTop = 30): Node {
  return h(
    {
      marginTop,
      paddingLeft: 30,
      paddingRight: 30,
      paddingTop: 16,
      paddingBottom: 16,
      borderRadius: RADIUS.md,
      background: 'rgba(23, 25, 20, 0.5)',
      border: `1px solid ${COLORS.badgeBorder}`,
      opacity,
    },
    text(content, { fontFamily: FONT.mono, fontSize: 30, color: COLORS.textOnHeroMuted }),
  );
}

// A capability pill that pops in with a slight overshoot.
function chip(label: string, a: number): Node {
  return h(
    {
      margin: 12,
      paddingLeft: 34,
      paddingRight: 34,
      paddingTop: 18,
      paddingBottom: 18,
      borderRadius: RADIUS.pill,
      background: COLORS.badgeBg,
      border: `1px solid ${COLORS.badgeBorder}`,
      opacity: a,
      transform: `translateY(${lerp(24, 0, easeOutBack(a))}px) scale(${lerp(0.9, 1, a)})`,
      transformOrigin: '50% 50%',
    },
    text(label, { fontFamily: FONT.serif, fontSize: 44, color: COLORS.badgeText }),
  );
}

// ---- Scene 1: logo reveal + version ----
function sceneLogo(t: number): Node {
  const op = windowOpacity(t, 0, 7.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const dangoOp = clamp(norm(t, 0.15, 1.2));
  const wordY = lerp(34, 0, easeOutCubic(clamp(norm(t, 0.5, 1.7))));
  const wordOp = clamp(norm(t, 0.5, 1.5));
  const pillA = clamp(norm(t, 1.4, 2.4));
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
    h(
      {
        marginTop: 30,
        paddingLeft: 34,
        paddingRight: 34,
        paddingTop: 12,
        paddingBottom: 12,
        borderRadius: RADIUS.pill,
        background: COLORS.badgeBg,
        border: `1px solid ${COLORS.badgeBorder}`,
        opacity: pillA,
        transform: `translateY(${lerp(20, 0, easeOutBack(pillA))}px)`,
      },
      text('version 0.8.0', {
        fontFamily: FONT.mono,
        fontSize: 30,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
        color: COLORS.accentGlow,
      }),
    ),
  ]);
}

// ---- Scene 2: release headline ----
function sceneRelease(t: number): Node {
  const op = windowOpacity(t, 6.5, 13.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const l1 = clamp(norm(t, 6.9, 7.9));
  const l2 = clamp(norm(t, 7.4, 8.6));
  return layer(op, [
    text('The biggest', {
      fontFamily: FONT.display,
      fontSize: 128,
      color: COLORS.textOnHero,
      letterSpacing: '-0.018em',
      lineHeight: 1.05,
      opacity: l1,
      transform: `translateY(${lerp(40, 0, easeOutCubic(l1))}px)`,
    }),
    text('release yet.', {
      fontFamily: FONT.display,
      fontSize: 128,
      color: COLORS.accentGlow,
      letterSpacing: '-0.018em',
      lineHeight: 1.1,
      opacity: l2,
      transform: `translateY(${lerp(40, 0, easeOutCubic(l2))}px)`,
    }),
    text('93 commits since 0.7.0.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 42,
      color: COLORS.textOnHeroMuted,
      marginTop: 34,
      opacity: clamp(norm(t, 8.4, 9.6)),
    }),
  ]);
}

// ---- Scene 3: image transformations ----
function sceneImages(t: number): Node {
  const op = windowOpacity(t, 12.5, 20.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const tiles = [
    { label: 'thumbnail', bg: `linear-gradient(135deg, ${COLORS.accentSoft}, ${COLORS.accent})` },
    { label: 'grayscale', bg: `linear-gradient(135deg, rgba(255,255,255,0.55), rgba(255,255,255,0.18))` },
    { label: 'saturate', bg: `linear-gradient(135deg, ${COLORS.accentGlow}, ${COLORS.accent})` },
    { label: 'brighten', bg: `linear-gradient(135deg, rgba(255,253,248,0.85), ${COLORS.accentGlow})` },
    { label: 'rotate90', bg: `linear-gradient(45deg, ${COLORS.accent}, ${COLORS.accentSoft})` },
    { label: 'flip', bg: `linear-gradient(225deg, ${COLORS.accentSoft}, ${COLORS.accentGlow})` },
  ];
  const tileNodes = tiles.map((tile, i) => {
    const a = clamp(norm(t, 13.2 + i * 0.18, 13.9 + i * 0.18));
    return h(
      {
        flexDirection: 'column',
        alignItems: 'center',
        margin: 14,
        opacity: a,
        transform: `translateY(${lerp(24, 0, easeOutBack(a))}px) scale(${lerp(0.85, 1, a)})`,
        transformOrigin: '50% 50%',
      },
      [
        h({
          width: 150,
          height: 150,
          borderRadius: RADIUS.md,
          backgroundImage: tile.bg,
          border: `1px solid ${COLORS.badgeBorder}`,
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        }),
        text(tile.label, { fontFamily: FONT.mono, fontSize: 22, color: COLORS.textOnHeroSubtle, marginTop: 12 }),
      ],
    );
  });
  return layer(op, [
    sectionLabel('image transformations', clamp(norm(t, 12.8, 13.7))),
    h({ width: 1120, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }, tileNodes),
    codePill('<Image src={photo} size="thumbnail" />', clamp(norm(t, 14.8, 16.0)), 40),
  ]);
}

// ---- Scene 4: email sending (embeds the dev outbox screenshot) ----
function sceneEmail(t: number): Node {
  const op = windowOpacity(t, 19.5, 27.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const imgA = clamp(norm(t, 20.2, 21.6));
  const W = 780;
  const H = Math.round((W * 787) / 1400); // preserve the 1400x787 aspect
  return layer(op, [
    sectionLabel('email sending', clamp(norm(t, 19.8, 20.7))),
    h(
      {
        borderRadius: RADIUS.lg,
        border: `1px solid ${COLORS.badgeBorder}`,
        boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        opacity: imgA,
        transform: `translateY(${lerp(30, 0, easeOutCubic(imgA))}px)`,
      },
      img(IMG_EMAIL, W, H, { borderRadius: RADIUS.lg }),
    ),
    codePill('await Mochi.email({ to, subject, html })', clamp(norm(t, 21.6, 22.8))),
  ]);
}

// ---- Scene 5: queues ----
function sceneQueues(t: number): Node {
  const op = windowOpacity(t, 26.5, 34.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const diagA = clamp(norm(t, 28.0, 29.2));
  const trackW = 480;
  const dl = Math.max(0, t - 28.2);
  const DOT_N = 5;
  const dots: Node[] = [];
  for (let i = 0; i < DOT_N; i++) {
    const phase = (dl * 0.5 + i / DOT_N) % 1; // 0..1 loop from request lane to background lane
    const x = phase * trackW;
    const fade = Math.min(clamp(phase / 0.12), clamp((1 - phase) / 0.12));
    dots.push(
      h({
        position: 'absolute',
        left: 0,
        top: 0,
        width: 22,
        height: 22,
        borderRadius: RADIUS.pill,
        background: COLORS.accentGlow,
        boxShadow: '0 0 14px rgba(162,207,177,0.9)',
        opacity: fade,
        transform: `translate(${x}px, 0px)`,
      }),
    );
  }
  return layer(op, [
    sectionLabel('queues', clamp(norm(t, 26.8, 27.7))),
    codePill('Mochi.queue({ concurrency, process })', clamp(norm(t, 27.3, 28.5)), 0),
    h({ flexDirection: 'row', alignItems: 'center', marginTop: 46, opacity: diagA }, [
      laneBox('request', false),
      h({ position: 'relative', width: trackW, height: 22, marginLeft: 24, marginRight: 24 }, dots),
      laneBox('background', true),
    ]),
    text('Take slow work off the request path.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 40,
      color: COLORS.textOnHeroMuted,
      marginTop: 44,
      opacity: clamp(norm(t, 29.6, 30.8)),
    }),
  ]);
}

function laneBox(labelText: string, accent: boolean): Node {
  return h(
    {
      paddingLeft: 26,
      paddingRight: 26,
      paddingTop: 18,
      paddingBottom: 18,
      borderRadius: RADIUS.md,
      background: accent ? 'rgba(162, 207, 177, 0.16)' : COLORS.cardIdle,
      border: `1px solid ${accent ? COLORS.cardHydratedBorder : COLORS.cardIdleBorder}`,
    },
    text(labelText, {
      fontFamily: FONT.mono,
      fontSize: 26,
      color: COLORS.textOnHeroMuted,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
    }),
  );
}

// ---- Scene 6: form captcha ----
function sceneCaptcha(t: number): Node {
  const op = windowOpacity(t, 33.5, 40.5, 0.7);
  if (op <= 0) {
    return null;
  }
  const widgetA = clamp(norm(t, 34.3, 35.5));
  // Slider that drags to the end, holds a solved state, then loops.
  const cyc = 3.4;
  const local = Math.max(0, t - 34.8);
  const ph = (local % cyc) / cyc; // 0..1
  const slide = easeOutCubic(clamp(ph / 0.66)); // reaches 1 at 66% of the cycle, then holds
  const solved = ph > 0.66;
  const trackW = 640;
  const handle = 58;
  const fillW = slide * (trackW - handle) + handle;
  const track = h(
    {
      position: 'relative',
      width: trackW,
      height: handle,
      borderRadius: RADIUS.pill,
      background: COLORS.cardIdle,
      border: `1px solid ${COLORS.cardIdleBorder}`,
      alignItems: 'center',
    },
    [
      h({
        position: 'absolute',
        left: 0,
        top: 0,
        width: fillW,
        height: handle,
        borderRadius: RADIUS.pill,
        background: solved ? 'rgba(162, 207, 177, 0.3)' : 'rgba(162, 207, 177, 0.16)',
      }),
      h(
        {
          position: 'absolute',
          left: 0,
          top: 0,
          width: handle,
          height: handle,
          borderRadius: RADIUS.pill,
          background: solved ? COLORS.accentGlow : COLORS.accentSoft,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translate(${slide * (trackW - handle)}px, 0px)`,
        },
        solved
          ? // a check drawn as a rotated L (avoids relying on a ✓ glyph in the font subset)
            h({
              width: 14,
              height: 26,
              marginBottom: 6,
              borderRightWidth: 5,
              borderRightStyle: 'solid',
              borderRightColor: COLORS.inkDark,
              borderBottomWidth: 5,
              borderBottomStyle: 'solid',
              borderBottomColor: COLORS.inkDark,
              transform: 'rotate(45deg)',
            })
          : h({ width: 16, height: 16, borderRadius: RADIUS.pill, background: 'rgba(23,25,20,0.4)' }),
      ),
    ],
  );
  return layer(op, [
    sectionLabel('form captcha', clamp(norm(t, 33.8, 34.7))),
    h({ opacity: widgetA, transform: `translateY(${lerp(24, 0, easeOutCubic(widgetA))}px)` }, track),
    text('Proof-of-work · no third-party service.', {
      fontFamily: FONT.serif,
      fontStyle: 'italic',
      fontSize: 40,
      color: COLORS.textOnHeroMuted,
      marginTop: 44,
      opacity: clamp(norm(t, 35.6, 36.8)),
    }),
  ]);
}

// ---- Scene 7: rate limiting ----
function sceneRateLimit(t: number): Node {
  const op = windowOpacity(t, 40.0, 47.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const meterA = clamp(norm(t, 40.6, 41.8));
  // Fill five pips, then a sixth request trips a red 429, shake, cool down, loop.
  const cyc = 4.0;
  const local = Math.max(0, t - 41.4);
  const ph = local % cyc; // seconds within the cycle
  const filled = Math.min(5, Math.floor(ph / 0.42));
  const tripped = ph >= 2.5 && ph < 3.6;
  const shake = tripped ? Math.sin(ph * 55) * 5 : 0;
  const PIP_N = 5;
  const pips: Node[] = [];
  for (let i = 0; i < PIP_N; i++) {
    const on = i < filled && !tripped;
    pips.push(
      h({
        width: 120,
        height: 46,
        margin: 8,
        borderRadius: RADIUS.sm,
        background: tripped ? 'rgba(217, 83, 79, 0.85)' : on ? COLORS.accentSoft : COLORS.cardIdle,
        border: `1px solid ${tripped ? ERROR_RED : on ? COLORS.cardHydratedBorder : COLORS.cardIdleBorder}`,
      }),
    );
  }
  return layer(op, [
    sectionLabel('rate limiting', clamp(norm(t, 40.3, 41.2))),
    h({ flexDirection: 'row', opacity: meterA, transform: `translate(${shake}px, 0px)` }, pips),
    text(tripped ? '429 · cooling down' : 'requests allowed', {
      fontFamily: FONT.mono,
      fontSize: 30,
      letterSpacing: '0.08em',
      color: tripped ? ERROR_RED : COLORS.accentGlow,
      marginTop: 26,
      opacity: meterA,
    }),
    codePill("rateLimit: { limit: 100, window: '1m' }", clamp(norm(t, 42.4, 43.6))),
  ]);
}

// ---- Scene 8: recap + debug bar screenshot ----
function sceneMore(t: number): Node {
  const op = windowOpacity(t, 46.5, 53.5, 0.7);
  if (op <= 0) {
    return null;
  }
  const head = clamp(norm(t, 46.8, 47.8));
  const chips = ['Client-only', 'Debug bar', 'Logging', 'CLI'];
  const chipNodes = chips.map((label, i) => chip(label, clamp(norm(t, 47.6 + i * 0.22, 48.3 + i * 0.22))));
  const imgA = clamp(norm(t, 48.9, 50.1));
  const W = 1000;
  const H = Math.round((W * 72) / 1036); // preserve the 1036x72 aspect (~69)
  return layer(op, [
    text('And more.', {
      fontFamily: FONT.display,
      fontSize: 104,
      color: COLORS.textOnHero,
      letterSpacing: '-0.018em',
      opacity: head,
      transform: `translateY(${lerp(30, 0, easeOutCubic(head))}px)`,
    }),
    h({ width: 1180, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 24, marginBottom: 44 }, chipNodes),
    h(
      {
        borderRadius: RADIUS.md,
        border: `1px solid ${COLORS.badgeBorder}`,
        boxShadow: '0 18px 46px rgba(0,0,0,0.38)',
        opacity: imgA,
        transform: `translateY(${lerp(26, 0, easeOutCubic(imgA))}px)`,
      },
      img(IMG_DEBUGBAR, W, H, { borderRadius: RADIUS.md }),
    ),
  ]);
}

// ---- Scene 9: close ----
function sceneClose(t: number): Node {
  const op = windowOpacity(t, 53.0, 58.0, 0.8);
  if (op <= 0) {
    return null;
  }
  const enter = easeOutCubic(clamp(norm(t, 53.3, 54.4)));
  return layer(op, [
    h({ marginBottom: 16, opacity: enter }, dango(78)),
    text('mochi 0.8.0', {
      fontFamily: FONT.display,
      fontSize: 140,
      color: COLORS.textOnHero,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      opacity: enter,
    }),
    codePill('bun add mochi-framework@latest', clamp(norm(t, 54.4, 55.4))),
    text('mochi.fast', {
      fontFamily: FONT.mono,
      fontSize: 32,
      letterSpacing: '0.18em',
      color: COLORS.accentGlow,
      marginTop: 26,
      opacity: clamp(norm(t, 55.4, 56.4)),
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
  const frac = clamp(t / DURATION_S);
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
  const scenes = [sceneLogo(t), sceneRelease(t), sceneImages(t), sceneEmail(t), sceneQueues(t), sceneCaptcha(t), sceneRateLimit(t), sceneMore(t), sceneClose(t)].filter(Boolean);
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
