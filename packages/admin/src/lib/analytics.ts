// Demo analytics series. Deterministic (no Math.random / Date.now) so the
// server render and client hydration produce identical markup — important for
// the live chart's SSR seed. A real app would pull these from the database.

export interface Point {
  /** x — day index or tick. */
  t: number;
  /** y — value. */
  v: number;
}

/** 30-day revenue trend, rendered as the non-hydrated (SSR-only) sparkline. */
export const REVENUE_TREND: Point[] = Array.from({ length: 30 }, (_, i) => ({
  t: i,
  v: Math.round(900 + 340 * Math.sin(i / 4) + i * 24),
}));

/** Seed for the live traffic chart. The hydrated island appends fresh points
 *  client-side after mount; this deterministic seed keeps SSR === first render. */
export const TRAFFIC_SEED: Point[] = Array.from({ length: 24 }, (_, i) => ({
  t: i,
  v: Math.round(120 + 42 * Math.sin(i / 3) + 16 * Math.cos(i / 2)),
}));
