// Memory-regression driver for packages/site. Supervises a single container:
// spawns the site, hammers every URL from its sitemap in a continuous loop, and
// captures a V8 heap snapshot to a mounted volume on a fixed interval so heap
// growth can be diffed in Chrome DevTools over a multi-day unattended run.
//
// Reuses the site's existing HTTP endpoints — no site source changes:
//   /health/                  readiness probe
//   /sitemap.xml              URL inventory (every doc + internal demo)
//   /_heapsnapshot            Bun.generateHeapSnapshot('v8') download
//   /__mochi/health/memory    post-GC process.memoryUsage() (needs MOCHI_MEMORY_PROBE=1)
//
// The site runs as a child process so its heap stays isolated: the snapshot we
// pull over HTTP is purely the site's, never polluted by this driver.

import path from 'node:path';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';

const ROOT = path.join(import.meta.dir, '..');

const PORT = Number(process.env.PORT) || 3333;
const BASE = `http://127.0.0.1:${PORT}`;
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || '/snapshots';
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS) || 3_600_000; // 1h
const SNAPSHOT_KEEP = Number(process.env.SNAPSHOT_KEEP) || 48;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 8;
const LOOP_DELAY_MS = Number(process.env.LOOP_DELAY_MS) || 0;
const MEM_LOG_INTERVAL_MS = Number(process.env.MEM_LOG_INTERVAL_MS) || 300_000; // 5m
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS) || 120_000;
// Bound each load/probe request so a single hung upstream (e.g. a slow remote
// dependency in an SSR page) can't wedge a worker forever in a multi-day run.
// The snapshot fetch is exempt — a large heap legitimately takes a while.
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 30_000;
// The heap snapshot is large (tens of MB); allow it longer than a normal request
// but never unbounded, so a stuck capture can't wedge the snapshot loop forever.
const SNAPSHOT_TIMEOUT_S = Math.ceil((Number(process.env.SNAPSHOT_TIMEOUT_MS) || 120_000) / 1000);
const SPAWN_SITE = process.env.SPAWN_SITE !== 'false';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function spawnSite(): void {
  log(`spawning site: bun run dev:site (PORT=${PORT})`);
  const proc = Bun.spawn(['bun', 'run', 'dev:site'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  // If the site dies, the harness is meaningless — exit non-zero so Docker's
  // restart policy recycles the whole container.
  void proc.exited.then((code) => {
    log(`site process exited (code ${code}); shutting down driver`);
    process.exit(1);
  });
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/`, { signal: AbortSignal.timeout(5_000) });
      await res.arrayBuffer();
      if (res.ok) {
        log('site is ready');
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`site did not become ready within ${READY_TIMEOUT_MS}ms`);
}

async function fetchSitemapPaths(): Promise<string[]> {
  const res = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const xml = await res.text();
  const paths: string[] = [];
  // Sitemap <loc>s are hardcoded to https://mochi.fast — keep only path+search
  // and re-anchor to the local server.
  for (const m of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    try {
      const u = new URL(m[1]);
      paths.push(u.pathname + u.search);
    } catch {
      // skip malformed loc
    }
  }
  return paths;
}

async function runPool(paths: string[]): Promise<void> {
  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < paths.length) {
      const p = paths[idx++];
      try {
        const res = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        await res.arrayBuffer(); // drain the body so it's freed
      } catch (err) {
        log(`fetch failed for ${p}: ${String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length || 1) }, worker));
}

async function loadLoop(): Promise<void> {
  let pass = 0;
  for (;;) {
    try {
      const paths = await fetchSitemapPaths();
      await runPool(paths);
      pass++;
      if (pass % 10 === 0) {
        log(`load loop: completed pass ${pass} (${paths.length} urls/pass)`);
      }
    } catch (err) {
      log(`load loop error: ${String(err)}`);
      await sleep(2000);
    }
    if (LOOP_DELAY_MS > 0) {
      await sleep(LOOP_DELAY_MS);
    }
  }
}

async function pruneSnapshots(): Promise<void> {
  const all = (await readdir(SNAPSHOT_DIR)).filter((f) => f.startsWith('heap-') && f.endsWith('.heapsnapshot')).sort(); // timestamp prefix is fixed-width → lexicographic == chronological
  const excess = all.slice(0, Math.max(0, all.length - SNAPSHOT_KEEP));
  for (const f of excess) {
    await unlink(path.join(SNAPSHOT_DIR, f));
    log(`pruned old snapshot ${f}`);
  }
}

async function captureSnapshot(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAPSHOT_DIR, `heap-${stamp}.heapsnapshot`);
  // Download via curl in a separate process: it streams the large body straight
  // to disk with constant memory and no event-loop contention with the load loop
  // (draining a big response inside this process deadlocks on TCP backpressure).
  // -L follows the trailingSlash:'always' redirect; --fail treats HTTP >=400 as error.
  const proc = Bun.spawn(['curl', '-sS', '--fail', '-L', '--max-time', String(SNAPSHOT_TIMEOUT_S), '-o', file, `${BASE}/_heapsnapshot`], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    log(`snapshot capture failed (curl exit ${code})${stderr ? `: ${stderr}` : ''}`);
    await unlink(file).catch(() => {}); // curl may leave a partial/empty file
    return;
  }
  const { size } = await stat(file);
  log(`wrote snapshot ${path.basename(file)} (${(size / 1_048_576).toFixed(1)} MB)`);
  await pruneSnapshots();
}

async function snapshotLoop(): Promise<void> {
  for (;;) {
    await sleep(SNAPSHOT_INTERVAL_MS);
    await captureSnapshot();
  }
}

async function memLogLoop(): Promise<void> {
  for (;;) {
    await sleep(MEM_LOG_INTERVAL_MS);
    try {
      const res = await fetch(`${BASE}/__mochi/health/memory`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        await res.arrayBuffer();
        continue;
      }
      const { memory } = (await res.json()) as { memory: Record<string, number> };
      const mb = (n: number): string => (n / 1_048_576).toFixed(1);
      log(`mem (post-gc): rss=${mb(memory.rss)}MB heapUsed=${mb(memory.heapUsed)}MB external=${mb(memory.external)}MB`);
    } catch (err) {
      log(`mem probe failed: ${String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  log(`memtest driver starting — snapshotDir=${SNAPSHOT_DIR} interval=${SNAPSHOT_INTERVAL_MS}ms keep=${SNAPSHOT_KEEP} concurrency=${CONCURRENCY}`);
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  if (SPAWN_SITE) {
    spawnSite();
  } else {
    log('SPAWN_SITE=false — expecting an externally started site');
  }
  await waitForReady();
  // Fire all three loops; they run forever until the site (or container) dies.
  await Promise.all([loadLoop(), snapshotLoop(), memLogLoop()]);
}

void main();
