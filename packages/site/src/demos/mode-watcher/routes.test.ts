import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { handle, routes } from './routes';
import { THEME_COOKIE } from './constants';

describe('mode-watcher handle', () => {
  let server: Server<undefined> | undefined;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '..', '.mochi-mode-watcher-'));
    server = await Mochi.serve({ port: 0, development: false, logger: { enabled: false }, outDir, routes, handle });
    base = `http://localhost:${server.port}`;
  }, 120_000);

  afterAll(() => {
    server?.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test.each(['/demos/mode-watcher/x', '/demos/mode-watcher/favicon.ico', '/demos/mode-watcherX'])('unmatched %s is a 404, not a 500', async (p) => {
    const res = await fetch(base + p, { headers: { Cookie: `${THEME_COOKIE}=dark` } });
    expect(res.status).toBe(404);
  });

  test('the demo page still renders dark from the cookie', async () => {
    const res = await fetch(base + '/demos/mode-watcher', { headers: { Cookie: `${THEME_COOKIE}=dark` } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html lang="en" class="dark">');
  });

  test('the demo page stays light without the cookie', async () => {
    const res = await fetch(base + '/demos/mode-watcher');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<html lang="en">');
  });
});
