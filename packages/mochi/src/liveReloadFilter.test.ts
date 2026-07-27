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
    // The server greets every client with `boot:<id>`; only reload signals matter here.
    const collect = (into: string[]) => (e: MessageEvent) => {
      const data = typeof e.data === 'string' ? e.data : '';
      if (!data.startsWith('boot:')) {
        into.push(data);
      }
    };
    wsA.addEventListener('message', collect(aMessages));
    wsB.addEventListener('message', collect(bMessages));

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

  // A tab that was disconnected when its entry recompiled never received the
  // `reload`, and the boot id alone can't tell it — the server never
  // restarted. The greeting's generation is what closes that hole.
  test('the boot greeting advances its generation for an entry that was reloaded while offline', async () => {
    const greet = async (entry: string) => {
      const ws = new WebSocket(`ws://localhost:${port}/__mochi_live_reload?entry=${encodeURIComponent(entry)}`);
      const message = await new Promise<string>((resolve) => {
        ws.addEventListener('message', (e) => resolve(typeof e.data === 'string' ? e.data : ''), { once: true });
      });
      return { ws, message };
    };

    const first = await greet(pageA);
    expect(first.message).toMatch(/^boot:[0-9a-f-]{36}:\d+$/);
    const [bootId, generation] = first.message.slice('boot:'.length).split(':');

    // Server replies to the client heartbeat, so a half-open socket is
    // detectable as silence.
    const pong = new Promise<string>((resolve) => {
      first.ws.addEventListener('message', (e) => resolve(typeof e.data === 'string' ? e.data : ''), { once: true });
    });
    first.ws.send('ping');
    expect(await pong).toBe('pong');

    // Go offline, then change the page the tab was on.
    first.ws.close();
    const completed = new Promise<MochiRecompileCompleteEvent>((resolve) => {
      const handler = (e: MochiRecompileCompleteEvent) => {
        if (e.trigger === 'file') {
          mochiEvents.off('recompile:complete', handler);
          resolve(e);
        }
      };
      mochiEvents.on('recompile:complete', handler);
    });
    writeFileSync(pageA, '<h1 class="lr-a">A v3</h1>\n');
    await completed;
    await new Promise((r) => setTimeout(r, 200));

    const second = await greet(pageA);
    const [reconnectBootId, reconnectGeneration] = second.message.slice('boot:'.length).split(':');
    expect(reconnectBootId).toBe(bootId);
    expect(Number(reconnectGeneration)).toBe(Number(generation) + 1);
    second.ws.close();

    // PageB was untouched, so a tab on it must not be told to reload.
    const untouched = await greet(pageB);
    expect(Number(untouched.message.slice('boot:'.length).split(':')[1])).toBe(0);
    untouched.ws.close();
  });
});
