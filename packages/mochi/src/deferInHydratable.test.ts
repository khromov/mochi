// `mochi:defer*` inside a hydratable subtree is a fatal compile error: client bundles skip the island preprocessor,
// so on hydration the client renders the raw child where SSR emitted a placeholder (observed empirically as
// HYDRATION_ERROR + a client remount wiping the island). Both plain-hydrate and also-hydrate parents must trip it.
// Separate file because Mochi.serve() is one-per-process.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

const FIXTURE_PAGE = path.join(import.meta.dir, '__fixtures__', 'defer-in-hydratable', 'BadHydratePage.svelte');

describe('defer-in-hydratable compile error', () => {
  let server: Server<undefined>;
  let outDir: string;
  let body: string;
  let status: number;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-defer-in-hyd-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(FIXTURE_PAGE),
      },
    });
    const res = await fetch(`http://localhost:${server.port}/`);
    status = res.status;
    body = await res.text();
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('rendering the page fails instead of shipping a broken island', () => {
    expect(status).toBe(500);
  });

  test('a plain mochi:hydrate parent with a defer child is reported', () => {
    expect(body).toContain('mochi:defer inside a hydratable');
    expect(body).toContain('Leaf');
    expect(body).toContain('HydrateParent');
  });

  test('an also-hydrate parent with a defer:visible child is reported too', () => {
    expect(body).toContain('CombinedParent');
  });
});
