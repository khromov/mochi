export type TrafficPoint = { month: string; requests: number; cached: number };

export const traffic: TrafficPoint[] = [
  { month: 'Jan', requests: 1240, cached: 820 },
  { month: 'Feb', requests: 1380, cached: 940 },
  { month: 'Mar', requests: 1610, cached: 1170 },
  { month: 'Apr', requests: 1520, cached: 1090 },
  { month: 'May', requests: 1840, cached: 1390 },
  { month: 'Jun', requests: 2110, cached: 1660 },
  { month: 'Jul', requests: 2340, cached: 1880 },
  { month: 'Aug', requests: 2280, cached: 1810 },
  { month: 'Sep', requests: 2560, cached: 2040 },
  { month: 'Oct', requests: 2890, cached: 2350 },
  { month: 'Nov', requests: 3120, cached: 2580 },
  { month: 'Dec', requests: 3410, cached: 2870 },
];

export type BundleRow = { route: string; html: number; islands: number; css: number };

export const bundles: BundleRow[] = [
  { route: '/', html: 14, islands: 22, css: 9 },
  { route: '/docs', html: 19, islands: 12, css: 11 },
  { route: '/demos', html: 11, islands: 34, css: 8 },
  { route: '/blog', html: 16, islands: 7, css: 10 },
];

export type RuntimeSlice = { stage: string; ms: number };

export const runtimes: RuntimeSlice[] = [
  { stage: 'Server render', ms: 42 },
  { stage: 'Island hydration', ms: 27 },
  { stage: 'Asset transfer', ms: 19 },
  { stage: 'Idle', ms: 12 },
];

// Passed straight into LayerChart's `color` / `cRange` props, which write them into `fill`
// and `stroke` attributes. Custom properties inherit into SVG, so they resolve against
// `.chart-frame` and follow the site's theme toggle without any JavaScript.
export const seriesColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
