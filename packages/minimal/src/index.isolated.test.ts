import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';

const routes = {
  '/': Mochi.page('./src/HelloWorld.svelte'),
  '/health': Mochi.api(() => Response.json({ status: 'ok' })),
};

describe('minimal app', () => {
  let server: Server<undefined> | undefined;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-minimal-test-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      htmlShell: './src/shell.html',
      routes,
    });
    base = `http://localhost:${server.port}`;
    // Compiles the app inside the hook, which overruns bun's 5s default when the root `bun run test`
    // fans every workspace out in parallel.
  }, 60_000);

  afterAll(() => {
    // Guarded: if `beforeAll` failed, an unconditional stop() throws and buries the real error.
    server?.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET / renders Hello world', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hello Mochi!');
  });

  test('GET /health reports ok', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
