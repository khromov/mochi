import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';

describe('Mochi.serve({ bun })', () => {
  const servers: Server<undefined>[] = [];
  const outDirs: string[] = [];

  function tempOutDir(): string {
    const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-bun-passthrough-'));
    outDirs.push(dir);
    return dir;
  }

  afterAll(() => {
    for (const server of servers) {
      server?.stop(true);
    }
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Rejection happens before the process singleton is pinned, so these run before the one boot test below.
  test.each(['fetch', 'websocket', 'routes', 'error'])('rejects framework-owned key %p', async (key) => {
    const boot = Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: tempOutDir(),
      routes: {},
      bun: { [key]: (() => {}) as never },
    });
    await expect(boot).rejects.toThrow(`"${key}" is owned by the framework`);
  });

  test('spreads raw Bun.serve options through and boots', async () => {
    const server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: tempOutDir(),
      routes: {},
      bun: { idleTimeout: 42 },
    });
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);
  });
});
