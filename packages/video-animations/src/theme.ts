// Mochi brand tokens, lifted verbatim from packages/site/src/shell.html (:root) and Site.svelte.
export const COLORS = {
  // Hero gradient (Site.svelte hero) — the signature backdrop.
  heroFrom: '#2b3d33',
  heroTo: '#4a7c59',
  // Surfaces / text.
  cream: '#f5f3ec',
  surface: '#fffdf8',
  ink: '#1f2a24',
  inkDark: '#171914',
  // Accent green family.
  accent: '#4a7c59',
  accentSoft: '#8ab79a',
  accentGlow: '#a2cfb1',
  // Text on dark hero.
  textOnHero: '#ffffff',
  textOnHeroMuted: '#dfeae1',
  textOnHeroSubtle: 'rgba(224, 232, 226, 0.72)',
  // Island grid cards.
  cardIdle: 'rgba(255, 253, 248, 0.07)',
  cardIdleBorder: 'rgba(255, 253, 248, 0.14)',
  cardHydratedBorder: '#a2cfb1',
  // Badge palette (shell.html badge tokens).
  badgeBg: 'rgba(224, 235, 225, 0.16)',
  badgeBorder: 'rgba(199, 224, 205, 0.4)',
  badgeText: '#e6f1e8',
} as const;

export const RADIUS = { sm: 6, md: 8, lg: 16, pill: 999 } as const;

// Font family names as referenced in satori markup (assigned in generate.ts font config).
export const FONT = {
  display: 'Fraunces Display',
  serif: 'Fraunces',
  mono: 'JetBrains Mono',
} as const;

export const CANVAS = { width: 1920, height: 1080 } as const;
export const FPS = 30;
export const DURATION_S = 30;
export const TOTAL_FRAMES = FPS * DURATION_S;
