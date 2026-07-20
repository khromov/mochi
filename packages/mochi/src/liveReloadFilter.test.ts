// Previously .isolated.test.ts — all tests now run in isolated processes.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { mochiEvents } from './events';
import type { MochiRecompileCompleteEvent } from './events';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'live-reload-filter');

describe('live-reload only signals tabs whose entry was affected', () => {
  let server: Server<undefined>;
  let outDir: string;
  let workDir: string;
  let pageA: string;
  let pageB: string;
  let port: number;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-livereload-filter-'));
    workDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-livereload-pages-'));
    pageA = path.join(workDir, 'PageA.svelte');
    pageB = path.join(workDir, 'PageB.svelte');
    copyFileSync(path.join(FIXTURE_DIR, 'PageA.svelte'), pageA);
    copyFileSync(path.join(FIXTURE_DIR, 'PageB.svelte'), pageB);

    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      additionalWatchPaths: [workDir],
      routes: {
        '/a': Mochi.page(pageA),
        '/b': Mochi.page(pageB),
      },
    });
    if (server.port == null) {
      throw new Error('server.port not set');
    }
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  test('editing PageA.svelte sends reload only to the PageA WS client', async () => {
    const wsA = new WebSocket(`ws://localhost:${port}/__mochi_live_reload?entry=${encodeURIComponent(pageA)}`);
    const wsB = new WebSocket(`ws://localhost:${port}/__mochi_live_reload?entry=${encodeURIComponent(pageB)}`);

    const aMessages: string[] = [];
    const bMessages: string[] = [];
    wsA.addEventListener('message', (e) => aMessages.push(typeof e.data === 'string' ? e.data : ''));
    wsB.addEventListener('message', (e) => bMessages.push(typeof e.data === 'string' ? e.data : ''));

    await Promise.all([
      new Promise<void>((resolve) => wsA.addEventListener('open', () => resolve(), { once: true })),
      new Promise<void>((resolve) => wsB.addEventListener('open', () => resolve(), { once: true })),
    ]);

    // Capture the recompile:complete payload so the test can both wait for
    // the rebuild and assert on the affected `pages` set on the public event.
    const completed = new Promise<MochiRecompileCompleteEvent>((resolve) => {
      const handler = (e: MochiRecompileCompleteEvent) => {
        if (e.trigger === 'file') {
          mochiEvents.off('recompile:complete', handler);
          resolve(e);
        }
      };
      mochiEvents.on('recompile:complete', handler);
    });

    writeFileSync(pageA, '<h1 class="lr-a">A v2</h1>\n');

    const evt = await completed;
    // Settle: 100ms watcher debounce + WS message round-trip.
    await new Promise((r) => setTimeout(r, 200));

    expect(evt.pages).toEqual([pageA]);
    expect(aMessages).toEqual(['reload']);
    expect(bMessages).toEqual([]);

    wsA.close();
    wsB.close();
  });
});
