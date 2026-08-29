// Kept in sync manually with packages/site/src/shell.html (:root) and Site.svelte.
export const COLORS = {
  heroFrom: '#2b3d33',
  heroTo: '#4a7c59',
  cream: '#f5f3ec',
  surface: '#fffdf8',
  ink: '#1f2a24',
  inkDark: '#171914',
  accent: '#4a7c59',
  accentSoft: '#8ab79a',
  accentGlow: '#a2cfb1',
  textOnHero: '#ffffff',
  textOnHeroMuted: '#dfeae1',
  textOnHeroSubtle: 'rgba(224, 232, 226, 0.72)',
  cardIdle: 'rgba(255, 253, 248, 0.07)',
  cardIdleBorder: 'rgba(255, 253, 248, 0.14)',
  cardHydratedBorder: '#a2cfb1',
  badgeBg: 'rgba(224, 235, 225, 0.16)',
  badgeBorder: 'rgba(199, 224, 205, 0.4)',
  badgeText: '#e6f1e8',
} as const;

export const RADIUS = { sm: 6, md: 8, lg: 16, pill: 999 } as const;

export const CANVAS = { width: 1920, height: 1080 } as const;
// Square 4K canvas for changelog videos (see changelog/ + the changelog-video skill).
export const CANVAS_SQUARE = { width: 2160, height: 2160 } as const;
export const FPS = 30;
export const DURATION_S = 30;
export const TOTAL_FRAMES = FPS * DURATION_S;
