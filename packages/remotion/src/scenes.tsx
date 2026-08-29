// The five cross-faded scenes, ported 1:1 from frame.ts. Each scene's opacity envelope is
// windowOpacity(t, …); they overlap on one continuous timeline rather than cutting.
import type { ReactNode } from 'react';
import { COLORS, RADIUS, CANVAS } from './theme';
import { clamp, lerp, norm, easeOutCubic, easeOutBack, windowOpacity } from './anim';
import { Box, fontDisplay, fontSerif, fontSerifItalic, fontMono } from './ui';
import { Dango } from './Dango';

// Absolutely-positioned centered full-canvas layer.
const Layer = ({ opacity, children }: { opacity: number; children: ReactNode }) => (
  <Box
    style={{ position: 'absolute', top: 0, left: 0, width: CANVAS.width, height: CANVAS.height, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity }}
  >
    {children}
  </Box>
);

// ---- Scene 1: logo reveal ----
export const SceneLogo = ({ t }: { t: number }) => {
  const op = windowOpacity(t, 0, 6.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const dangoOp = clamp(norm(t, 0.15, 1.2));
  const wordY = lerp(34, 0, easeOutCubic(clamp(norm(t, 0.5, 1.7))));
  const wordOp = clamp(norm(t, 0.5, 1.5));
  return (
    <Layer opacity={op}>
      <Box style={{ opacity: dangoOp, marginBottom: 18 }}>
        <Dango ball={96} />
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 168, color: COLORS.textOnHero, letterSpacing: '-0.02em', lineHeight: 1, opacity: wordOp, transform: `translateY(${wordY}px)` }}>
        mochi
      </Box>
      <Box
        style={{ ...fontMono, fontSize: 30, letterSpacing: '0.32em', textTransform: 'uppercase', color: COLORS.textOnHeroSubtle, marginTop: 26, opacity: clamp(norm(t, 1.4, 2.4)) }}
      >
        an experimental SSR framework
      </Box>
    </Layer>
  );
};

// ---- Scene 2: tagline ----
export const SceneTagline = ({ t }: { t: number }) => {
  const op = windowOpacity(t, 5.6, 11.6, 0.7);
  if (op <= 0) {
    return null;
  }
  const l1 = clamp(norm(t, 5.9, 6.9));
  const l2 = clamp(norm(t, 6.4, 7.6));
  return (
    <Layer opacity={op}>
      <Box
        style={{
          ...fontDisplay,
          fontSize: 132,
          color: COLORS.textOnHero,
          letterSpacing: '-0.018em',
          lineHeight: 1.05,
          opacity: l1,
          transform: `translateY(${lerp(40, 0, easeOutCubic(l1))}px)`,
        }}
      >
        Render everything
      </Box>
      <Box
        style={{
          ...fontDisplay,
          fontSize: 132,
          color: COLORS.accentGlow,
          letterSpacing: '-0.018em',
          lineHeight: 1.1,
          opacity: l2,
          transform: `translateY(${lerp(40, 0, easeOutCubic(l2))}px)`,
        }}
      >
        on the server.
      </Box>
      <Box style={{ ...fontSerifItalic, fontSize: 40, color: COLORS.textOnHeroMuted, marginTop: 34, opacity: clamp(norm(t, 7.4, 8.6)) }}>
        Svelte 5 + Bun, server-side on every request.
      </Box>
    </Layer>
  );
};

// ---- Scene 3: islands / selective hydration ----
export const SceneIslands = ({ t }: { t: number }) => {
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

  const cards: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const on = hydrated.has(i);
    cards.push(
      <Box
        key={i}
        style={{
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
        }}
      >
        {/* little "lines of content" bars */}
        <Box style={{ width: '70%', height: 8, borderRadius: 4, background: on ? 'rgba(231,241,232,0.85)' : 'rgba(231,241,232,0.22)' }} />
        {on ? (
          <Box
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 14,
              height: 14,
              borderRadius: RADIUS.pill,
              background: COLORS.accentGlow,
              boxShadow: '0 0 12px rgba(162,207,177,0.9)',
            }}
          />
        ) : (
          <Box style={{ position: 'absolute', top: 10, right: 10, width: 14, height: 14, borderRadius: RADIUS.pill, border: '1px solid rgba(231,241,232,0.18)' }} />
        )}
      </Box>,
    );
  }

  return (
    <Layer opacity={op}>
      <Box
        style={{
          ...fontMono,
          fontSize: 24,
          letterSpacing: '0.34em',
          textTransform: 'uppercase',
          color: COLORS.textOnHeroSubtle,
          marginBottom: 30,
          opacity: clamp(norm(t, 11.5, 12.4)),
        }}
      >
        selective hydration
      </Box>
      <Box style={{ width: cols * 170, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>{cards}</Box>
      <Box style={{ ...fontSerifItalic, fontSize: 42, color: COLORS.textOnHeroMuted, marginTop: 36, opacity: clamp(norm(t, 13.0, 14.2)) }}>
        Ship JavaScript only where it earns its place.
      </Box>
    </Layer>
  );
};

// ---- Scene 4: capabilities ----
export const SceneCaps = ({ t }: { t: number }) => {
  const op = windowOpacity(t, 19.0, 25.0, 0.7);
  if (op <= 0) {
    return null;
  }
  const chips = ['SSR', 'Islands', 'Forms', 'WebSockets', 'SSE', 'Bun'];
  return (
    <Layer opacity={op}>
      <Box
        style={{
          ...fontDisplay,
          fontSize: 104,
          color: COLORS.textOnHero,
          letterSpacing: '-0.018em',
          marginBottom: 40,
          opacity: clamp(norm(t, 19.3, 20.2)),
          transform: `translateY(${lerp(30, 0, easeOutCubic(clamp(norm(t, 19.3, 20.4))))}px)`,
        }}
      >
        Batteries included.
      </Box>
      <Box style={{ width: 1240, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {chips.map((label, i) => {
          const a = clamp(norm(t, 20.0 + i * 0.28, 20.7 + i * 0.28));
          return (
            <Box
              key={label}
              style={{
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
              }}
            >
              <Box style={{ ...fontSerif, fontSize: 48, color: COLORS.badgeText, letterSpacing: '-0.005em' }}>{label}</Box>
            </Box>
          );
        })}
      </Box>
    </Layer>
  );
};

// ---- Scene 5: close ----
export const SceneClose = ({ t }: { t: number }) => {
  const op = windowOpacity(t, 24.6, 30.0, 0.8);
  if (op <= 0) {
    return null;
  }
  const enter = easeOutCubic(clamp(norm(t, 24.9, 26.0)));
  return (
    <Layer opacity={op}>
      <Box style={{ marginBottom: 16, opacity: enter }}>
        <Dango ball={78} />
      </Box>
      <Box style={{ ...fontDisplay, fontSize: 148, color: COLORS.textOnHero, letterSpacing: '-0.02em', lineHeight: 1, opacity: enter }}>mochi</Box>
      <Box style={{ ...fontMono, fontSize: 32, letterSpacing: '0.18em', color: COLORS.accentGlow, marginTop: 22, opacity: clamp(norm(t, 25.6, 26.6)) }}>mochi.fast</Box>
      <Box style={{ ...fontSerifItalic, fontSize: 30, color: COLORS.textOnHeroSubtle, marginTop: 30, opacity: clamp(norm(t, 26.4, 27.6)) }}>
        Early prototype — use in production if you are brave.
      </Box>
    </Layer>
  );
};

// Thin bottom progress bar in accent — a small nod that this is a timed piece.
export const ProgressBar = ({ t }: { t: number }) => {
  const frac = clamp(t / 30);
  return <Box style={{ position: 'absolute', left: 0, bottom: 0, width: CANVAS.width * frac, height: 6, background: COLORS.accentGlow, opacity: 0.55 }} />;
};
