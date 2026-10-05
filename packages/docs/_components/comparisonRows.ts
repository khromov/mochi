export type Status = 'yes' | 'no' | 'partial' | 'planned';
export type Category = 'performance' | 'backend' | 'frontend';
export interface Cell {
  status: Status;
  note?: string;
  href?: string;
}
export interface Row {
  feature: string;
  tags: Category[];
  mochi: Cell;
  kit: Cell;
}

export const rows: Row[] = [
  {
    feature: 'Server islands & selective hydration',
    tags: ['performance', 'frontend'],
    mochi: { status: 'yes', note: 'mochi:defer', href: '/docs/server-islands/' },
    kit: { status: 'no', note: 'full page hydration only' },
  },
  {
    feature: 'Built-in SQLite database',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'bun:sqlite', href: 'https://bun.com/docs/api/sqlite' },
    kit: { status: 'partial', note: 'node:sqlite via adapter-node on Node or Deno' },
  },
  {
    feature: 'Built-in Postgres & MySQL support',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'Bun.sql()', href: 'https://bun.com/docs/api/sql' },
    kit: { status: 'no', note: 'bring your own cloud database' },
  },
  {
    feature: 'Background job queues',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'Mochi.queue()', href: '/docs/queues/' },
    kit: { status: 'no' },
  },
  {
    feature: 'Minimal client-side JavaScript',
    tags: ['performance', 'frontend'],
    mochi: { status: 'yes', note: 'zero JS unless hydrated; tuned for first load' },
    kit: {
      status: 'partial',
      note: 'tuned for repeat navigations; no zero-JS pages (CSR opt-out breaks interactivity)',
      href: 'https://svelte.dev/docs/kit/glossary#CSR',
    },
  },
  {
    feature: 'Deployment targets',
    tags: ['backend'],
    mochi: { status: 'no', note: 'Bun only' },
    kit: { status: 'yes', note: 'Node, Vercel, Bun and other cloud providers' },
  },
  {
    feature: 'Prerendering / SSG',
    tags: ['performance', 'frontend'],
    mochi: { status: 'partial', note: 'route warmup supported', href: '/docs/serve-options/#route-warmup' },
    kit: { status: 'yes' },
  },
  { feature: 'Build as static HTML', tags: ['performance', 'frontend'], mochi: { status: 'no', note: 'SSR only' }, kit: { status: 'yes', note: 'adapter-static' } },
  { feature: 'Form actions + progressively enhanced forms', tags: ['backend', 'frontend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
  {
    feature: 'Form captcha',
    tags: ['backend', 'frontend'],
    mochi: { status: 'yes', note: 'MochiCaptcha', href: '/docs/captcha/' },
    kit: { status: 'no', note: 'third-party service' },
  },
  { feature: 'Rate limiting', tags: ['backend'], mochi: { status: 'yes' }, kit: { status: 'no', note: 'third-party package only' } },
  { feature: 'Middleware', tags: ['backend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
  {
    feature: 'Hooks & extension filters',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'eventHooks & filters', href: '/docs/extensions/' },
    kit: { status: 'no' },
  },
  { feature: 'Top-level await', tags: ['backend', 'frontend'], mochi: { status: 'yes' }, kit: { status: 'partial', note: 'experimental' } },
  {
    feature: 'Real-time WebSockets',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'Mochi.ws()', href: '/docs/websocket-routes/' },
    kit: { status: 'no', note: 'custom server with external package' },
  },
  {
    feature: 'Server-Sent Events',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'Mochi.sse()', href: '/docs/server-sent-events/' },
    kit: { status: 'no', note: 'manual setup, limited provider support' },
  },
  {
    feature: 'Built-in caching library',
    tags: ['performance', 'backend'],
    mochi: { status: 'yes', note: 'MochiCache', href: '/docs/cache/' },
    kit: { status: 'no' },
  },
  { feature: 'Cookie helpers', tags: ['backend'], mochi: { status: 'yes' }, kit: { status: 'yes' } },
  {
    feature: 'AI development support',
    tags: ['backend', 'frontend'],
    mochi: { status: 'yes', note: 'Skill, MCP & llms.txt', href: '/docs/docs-for-llms/' },
    kit: { status: 'yes', note: 'Skill, MCP & llms.txt', href: 'https://svelte.dev/docs/ai/overview' },
  },
  { feature: 'Client-side router', tags: ['frontend'], mochi: { status: 'no' }, kit: { status: 'yes' } },
  {
    feature: 'Type-safe routes & params',
    tags: ['backend', 'frontend'],
    mochi: { status: 'planned' },
    kit: { status: 'yes', note: 'generated ./$types & $app/types' },
  },
  { feature: 'Remote functions (type-safe RPC)', tags: ['backend', 'frontend'], mochi: { status: 'no' }, kit: { status: 'yes', note: 'experimental' } },
  {
    feature: 'View Transitions',
    tags: ['frontend'],
    mochi: { status: 'yes', note: 'built-in component', href: '/docs/view-transitions/' },
    kit: { status: 'partial', note: 'manual wiring', href: 'https://svelte.dev/blog/view-transitions' },
  },
  {
    feature: 'Highly interactive apps',
    tags: ['frontend'],
    mochi: { status: 'yes', note: 'WS, SSE & View Transitions' },
    kit: { status: 'yes', note: 'SPA mode & remote functions' },
  },
  { feature: 'Tailwind', tags: ['frontend'], mochi: { status: 'yes', note: 'Tailwind v4', href: '/docs/tailwind/' }, kit: { status: 'yes' } },
  {
    feature: 'Built-in Markdown (mdsvex)',
    tags: ['frontend'],
    mochi: { status: 'yes', note: 'mdsvex built-in', href: '/docs/mdsvex/' },
    kit: { status: 'yes', note: 'via integration (sv add mdsvex)' },
  },
  {
    feature: 'Centralized logging system',
    tags: ['backend'],
    mochi: { status: 'yes', note: 'mochiEvents', href: '/docs/events/' },
    kit: { status: 'no', note: 'experimental OpenTelemetry only' },
  },
  {
    feature: 'Image resizing',
    tags: ['performance', 'frontend'],
    mochi: { status: 'yes', note: 'named sizes, runtime transforms', href: '/docs/images/' },
    kit: { status: 'partial', note: 'build-time only; runtime at extra cost' },
  },
  { feature: 'Link preloading', tags: ['performance', 'frontend'], mochi: { status: 'planned' }, kit: { status: 'yes' } },
  { feature: 'Service worker integration', tags: ['performance', 'frontend'], mochi: { status: 'planned' }, kit: { status: 'yes' } },
  { feature: 'Snapshots', tags: ['frontend'], mochi: { status: 'partial', note: 'browser-native restoration' }, kit: { status: 'yes', note: 'manual setup' } },
];

export const rank: Record<Status, number> = { yes: 3, partial: 2, planned: 1, no: 0 };
