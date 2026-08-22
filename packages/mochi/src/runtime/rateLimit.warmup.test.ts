import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from '../Mochi';
import { mochiEvents, type MochiRequestEvent } from '../events';

const FIXTURE_PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'css-imports', 'Page.svelte');

describe('rateLimit ignores warmup requests', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  const warmupRequests: MochiRequestEvent[] = [];
  const collectWarmupRequests = (event: MochiRequestEvent) => {
    if (event.warmup) {
      warmupRequests.push(event);
    }
  };

  beforeAll(async () => {
    mochiEvents.on('request', collectWarmupRequests);
    const warmed = new Promise<void>((resolve) => {
      const handler = () => {
        mochiEvents.off('warmup:complete', handler);
        resolve();
      };
      mochiEvents.on('warmup:complete', handler);
    });
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ratelimit-warmup-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      warmup: { enabledInProd: true, enabledInDev: true },
      routes: {
        '/': Mochi.page(FIXTURE_PAGE, { rateLimit: { limit: 1, window: '1m' } }),
      },
    });
    base = `http://localhost:${server.port}`;
    await warmed;
  });

  afterAll(() => {
    mochiEvents.off('request', collectWarmupRequests);
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('warmup does not consume the quota; real requests do', async () => {
    const warmedRoot = warmupRequests.filter((event) => event.path === '/');
    expect(warmedRoot).toHaveLength(1);
    expect(warmedRoot[0]?.status).toBe(200);
    const firstResponse = await fetch(`${base}/`);
    expect(firstResponse.status).toBe(200);
    const secondResponse = await fetch(`${base}/`);
    expect(secondResponse.status).toBe(429);
  });
});
