export type RouteHit = {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  weight: number;
  body?: BodyInit;
  headers?: Record<string, string>;
};

export const STATIC_ROUTES: RouteHit[] = [
  { name: 'page:hello-world', method: 'GET', path: '/demos/hello-world', weight: 1 },
  { name: 'page:data-loading', method: 'GET', path: '/demos/data-loading/pikachu', weight: 1 },
  {
    name: 'form:data-loading',
    method: 'POST',
    path: '/demos/data-loading/pikachu',
    weight: 1,
    body: 'pokemon=charizard',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  },
  { name: 'page:server-island', method: 'GET', path: '/demos/server-island', weight: 1 },
  {
    name: 'api:cookie',
    method: 'POST',
    path: '/api/cookie',
    weight: 1,
    body: JSON.stringify({ name: 'leak-test', value: 'x' }),
    headers: { 'Content-Type': 'application/json' },
  },
  { name: 'api:health', method: 'GET', path: '/health', weight: 1 },
  { name: 'page:error-404', method: 'GET', path: '/demos/error/404', weight: 1 },
  { name: 'unmatched:404', method: 'GET', path: '/does-not-exist-xyz', weight: 0.3 },
];

const SERVER_ISLAND_RE = /<mochi-server-island\b[^>]*\bcomponent-name="([^"]+)"[^>]*\bsigned-props="([^"]+)"/;

export async function captureServerIslandHit(baseUrl: string): Promise<RouteHit | null> {
  // Captured from /__leak/server-island, not /demos/server-island — the demo
  // island has an artificial 1–3s `delay()` that would dominate latency stats
  // and block any meaningful p95-creep signal.
  const res = await fetch(`${baseUrl}/__leak/server-island`);
  if (!res.ok) {
    return null;
  }
  const html = await res.text();
  const m = SERVER_ISLAND_RE.exec(html);
  if (!m) {
    return null;
  }
  const componentName = m[1];
  const signedProps = m[2];
  if (!componentName || !signedProps) {
    return null;
  }
  const path = `/_mochi/island/${encodeURIComponent(componentName)}?props=${encodeURIComponent(signedProps)}`;
  return { name: 'island:server', method: 'GET', path, weight: 1 };
}

export function buildWeightedRing(routes: RouteHit[]): RouteHit[] {
  const ring: RouteHit[] = [];
  for (const r of routes) {
    const slots = Math.max(1, Math.round(r.weight * 10));
    for (let i = 0; i < slots; i++) {
      ring.push(r);
    }
  }
  return ring;
}
