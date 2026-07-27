import type { CiDashboardData, CiRateLimit } from '../lib/ci';

export interface BoardSeed {
  dashboard: CiDashboardData | null;
  rateLimit: CiRateLimit | null;
  serverNow: number;
}

// The server cache only turns over hourly; the poll just governs how quickly the page
// notices. Visibility-gated, so a background tab or an idle wall display costs nothing.
const POLL_MS = 300_000;
const TICK_MS = 15_000;

/**
 * Live CI board state, shared by the full page and the compact dashboard.
 * `now` is seeded from the server: a bare Date.now() would run during SSR *and* again
 * on hydration, so every relative timestamp would mismatch.
 */
export function createCiBoard(seed: BoardSeed) {
  let dashboard = $state(seed.dashboard);
  let rateLimit = $state(seed.rateLimit);
  let now = $state(seed.serverNow);
  let polling = $state(false);
  let failed = $state(false);

  async function refresh() {
    if (polling) {
      return;
    }
    polling = true;
    try {
      const res = await fetch('/ci/data/', { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const next = await res.json();
      dashboard = next.dashboard;
      rateLimit = next.rateLimit;
      now = Date.now();
      failed = false;
    } catch {
      // Keep the board we already have on screen; the caller surfaces `failed`.
      failed = true;
    } finally {
      polling = false;
    }
  }

  /** Call from an `$effect`; returns the teardown. */
  function start(): () => void {
    const tick = setInterval(() => {
      now = Date.now();
    }, TICK_MS);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        now = Date.now();
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  return {
    get dashboard() {
      return dashboard;
    },
    get rateLimit() {
      return rateLimit;
    },
    get now() {
      return now;
    },
    get polling() {
      return polling;
    },
    get failed() {
      return failed;
    },
    refresh,
    start,
  };
}
