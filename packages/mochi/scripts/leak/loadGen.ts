import type { RouteHit } from './routes';

export type Sample = { t: number; latencyMs: number; status: number };

export type RouteStats = {
  name: string;
  count: number;
  errors: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  samples: Sample[];
};

export type LoadStats = {
  totalRequests: number;
  totalErrors: number;
  byRoute: Map<string, RouteStats>;
  startedAt: number;
  endedAt: number;
};

function emptyStats(name: string): RouteStats {
  return {
    name,
    count: 0,
    errors: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    samples: [],
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx] ?? 0;
}

export function latenciesBetween(stats: LoadStats, fromMs: number, toMs: number): { p50: number; p95: number; count: number } {
  const lats: number[] = [];
  for (const r of stats.byRoute.values()) {
    for (const s of r.samples) {
      if (s.t >= fromMs && s.t < toMs) {
        lats.push(s.latencyMs);
      }
    }
  }
  lats.sort((a, b) => a - b);
  return { p50: percentile(lats, 0.5), p95: percentile(lats, 0.95), count: lats.length };
}

export type StartLoadOpts = {
  baseUrl: string;
  routes: RouteHit[];
  rps: number;
  durationMs: number;
  concurrency?: number;
  signal?: AbortSignal;
};

export async function startLoad(opts: StartLoadOpts): Promise<LoadStats> {
  const concurrency = opts.concurrency ?? Math.max(4, Math.min(64, Math.ceil(opts.rps / 4)));
  const perWorkerIntervalMs = (1000 * concurrency) / Math.max(1, opts.rps);

  const stats: LoadStats = {
    totalRequests: 0,
    totalErrors: 0,
    byRoute: new Map(),
    startedAt: Date.now(),
    endedAt: 0,
  };
  for (const r of opts.routes) {
    stats.byRoute.set(r.name, emptyStats(r.name));
  }

  const endAt = Date.now() + opts.durationMs;
  let cursor = 0;

  async function worker(workerId: number) {
    while (Date.now() < endAt && !opts.signal?.aborted) {
      const route = opts.routes[(cursor + workerId) % opts.routes.length];
      cursor++;
      if (!route) {
        continue;
      }
      const url = `${opts.baseUrl}${route.path}`;
      const t0 = performance.now();
      const tWall = Date.now();
      const routeStats = stats.byRoute.get(route.name);
      if (!routeStats) {
        continue;
      }
      try {
        const res = await fetch(url, {
          method: route.method,
          body: route.body,
          headers: route.headers,
          keepalive: true,
          redirect: 'manual',
          signal: opts.signal,
        });
        await res.arrayBuffer();
        const dt = performance.now() - t0;
        routeStats.count++;
        routeStats.samples.push({ t: tWall, latencyMs: dt, status: res.status });
        const s = res.status;
        if (s >= 200 && s < 300) {
          routeStats.status2xx++;
        } else if (s >= 300 && s < 400) {
          routeStats.status3xx++;
        } else if (s >= 400 && s < 500) {
          routeStats.status4xx++;
        } else if (s >= 500) {
          routeStats.status5xx++;
        }
        stats.totalRequests++;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
        routeStats.errors++;
        stats.totalErrors++;
      }
      const elapsed = performance.now() - t0;
      const wait = Math.max(0, perWorkerIntervalMs - elapsed);
      if (wait > 0) {
        await Bun.sleep(wait);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  stats.endedAt = Date.now();
  return stats;
}
