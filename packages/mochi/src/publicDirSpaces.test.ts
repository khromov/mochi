import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

// Poll a URL until it returns the expected status or the deadline passes. The
// dev watcher debounces public-dir changes (~100ms) and chokidar's event
// latency varies by platform, so the live-add assertion can't fetch immediately.
async function fetchUntil(url: string, status: number, timeoutMs = 8000): Promise<Response> {
  const deadline = performance.now() + timeoutMs;
  let last: Response | undefined;
  while (performance.now() < deadline) {
    last = await fetch(url);
    if (last.status === status) {
      return last;
    }
    await Bun.sleep(50);
  }
  return last!;
}

// End-to-end guard for public assets whose filenames contain a space. The
// browser sends the percent-encoded form (`/a%20b.txt`), while the file is
// discovered with a raw-space URL key; this confirms it is registered under the
// encoded key (publicRouteKey) so the two match and the bytes come back. Covers
// both registration paths: startup (Mochi.serve) and the dev-watcher reload
// that re-registers public files when the directory changes at runtime.
describe('public files with spaces in their names are served', () => {
  let server: Server<undefined>;
  let outDir: string;
  let publicDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-public-spaces-out-'));
    publicDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-public-spaces-'));
    writeFileSync(path.join(publicDir, 'a b.txt'), 'SPACED_TOP_LEVEL');
    mkdirSync(path.join(publicDir, 'my dir'), { recursive: true });
    writeFileSync(path.join(publicDir, 'my dir', 'log o.txt'), 'SPACED_NESTED');

    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      publicDir,
      // The dev watcher only covers the default `src`/`public` paths; point it at
      // the temp publicDir so the live-add reload path below is actually exercised.
      additionalWatchPaths: [publicDir],
      routes: {},
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
  });

  test('serves a top-level file via its percent-encoded URL', async () => {
    const res = await fetch(`${base}/a%20b.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SPACED_TOP_LEVEL');
  });

  test('serves a file under a directory whose name also contains a space', async () => {
    const res = await fetch(`${base}/my%20dir/log%20o.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SPACED_NESTED');
  });

  // Regression for the dev-watcher reload path: adding a spaced file at runtime
  // previously re-registered every public file under its raw key, 404-ing them.
  test('serves a spaced file added after startup (dev-watcher reload)', async () => {
    writeFileSync(path.join(publicDir, 'added later.txt'), 'SPACED_LIVE_ADD');
    // Generous deadline: under full-suite parallel load, chokidar's watch+debounce
    // latency can exceed the default 8s, causing a flaky 404 before the route is
    // re-registered. 20s keeps the assertion meaningful without flaking.
    const res = await fetchUntil(`${base}/added%20later.txt`, 200, 20_000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SPACED_LIVE_ADD');
  });
});
