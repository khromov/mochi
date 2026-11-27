import { afterAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import type { SqliteStorage } from './cache/cache-storage';
import { resetStartupMilestones } from './lifecycle';
import { toPosixPath } from './utils';

const projectDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-cache-ssr-'));
let server: Server<undefined> | undefined;

afterAll(async () => {
  server?.stop(true);
  const stores = ((globalThis as Record<string, unknown>).__testSsrCacheStores ?? []) as SqliteStorage[];
  for (const store of stores) {
    await store.dispose();
  }
  delete (globalThis as Record<string, unknown>).__testSsrCacheStores;
  resetStartupMilestones();
  rmSync(projectDir, { recursive: true, force: true });
});

describe('SqliteStorage inside compiled Svelte SSR pages', () => {
  test('applies its embedded schema and caches across requests from bundled .mochi SSR chunks', async () => {
    const sharedDb = toPosixPath(path.join(projectDir, 'app.db'));
    const standaloneDb = toPosixPath(path.join(projectDir, 'standalone-cache.db'));
    const srcDir = path.join(projectDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    const pagePath = path.join(srcDir, 'Page.svelte');
    writeFileSync(
      pagePath,
      `<script module lang="ts">
  import { MochiCache, SqliteStorage } from 'mochi-framework';

  const s1 = new SqliteStorage({ path: '${sharedDb}', namespace: 'ssr-shared', purgeInterval: 0 });
  const s2 = new SqliteStorage({ path: '${standaloneDb}', namespace: 'ssr-standalone', purgeInterval: 0 });
  (globalThis as Record<string, unknown>).__testSsrCacheStores = [s1, s2];

  let sharedCalls = 0;
  let standaloneCalls = 0;
  const sharedCache = new MochiCache({ storage: s1, minTimeToStale: 60_000, maxTimeToLive: 120_000 });
  const standaloneCache = new MochiCache({ storage: s2, minTimeToStale: 60_000, maxTimeToLive: 120_000 });
</script>

<script lang="ts">
  const sharedVal = await sharedCache.fetch('greeting', () => \`shared-\${++sharedCalls}\`);
  const standaloneVal = await standaloneCache.fetch('greeting', () => \`standalone-\${++standaloneCalls}\`);
</script>

<p>{sharedVal} / {standaloneVal}</p>
`,
    );

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(projectDir, '.mochi'),
      storage: { type: 'sqlite', path: sharedDb },
      routes: {
        '/': Mochi.page(pagePath),
      },
    });

    const first = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain('shared-1 / standalone-1');

    const second = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('shared-1 / standalone-1');
  });
});
