import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractServeOptions, extractStandaloneOptions } from './extractServeOptions';
import { isBuilding } from '../utils/buildFlag';
import { Mochi } from '../Mochi';
import { startQueueRuntime, mountQueues, closeAllQueueResources } from '../queue';

// The extractor registers a process-global Bun.plugin that overrides the
// `mochi-framework` specifier. Keep these tests in their own file so the
// override never leaks into tests that import the real framework.
describe('extractServeOptions', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    delete (globalThis as Record<string, unknown>).__test_isBuilding;
  });

  function writeEntry(body: string): string {
    dir = mkdtempSync(path.join(tmpdir(), 'extract-serve-'));
    const entry = path.join(dir, 'entry.ts');
    writeFileSync(entry, body);
    return entry;
  }

  // A sibling of the first entry, so afterEach's single `dir` cleanup covers both.
  function writeSecondEntry(body: string): string {
    const entry = path.join(dir!, 'entry2.ts');
    writeFileSync(entry, body);
    return entry;
  }

  test('captures Mochi.serve options without binding a port', async () => {
    const entry = writeEntry(
      `import { Mochi } from 'mochi-framework';
await Mochi.serve({ optimize: { enabled: true, exclude: ['x.svelte'] }, routes: {} });
throw new Error('serve should have halted execution before this line');`,
    );

    const options = await extractServeOptions(entry);

    expect(options).not.toBeNull();
    expect(options?.optimize).toEqual({ enabled: true, exclude: ['x.svelte'] });
  });

  test('captures the queues array without starting the queue runtime', async () => {
    // Mochi.queue() is inert config, so importing the entry for extraction must
    // not start a BunBoss instance (whose maintenance timers would hang the
    // build). The test simply completing proves nothing kept the event loop alive.
    const entry = writeEntry(
      `import { Mochi } from 'mochi-framework';
await Mochi.serve({ routes: {}, queueStorage: 'memory', queues: [Mochi.queue('emails', { process: async () => ({ sent: true }), concurrency: 2 })] });
throw new Error('serve should have halted execution before this line');`,
    );

    const options = await extractServeOptions(entry);

    expect(options?.queues).toBeDefined();
    expect(options?.queues?.[0]?.__mochiQueue).toBe(true);
    expect(options?.queues?.[0]?.name).toBe('emails');
    expect(options?.queues?.[0]?.options).toEqual({ concurrency: 2 });
    expect(options?.queueStorage).toBe('memory');
  });

  test('marks isBuilding true while executing the entry', async () => {
    const entry = writeEntry(
      `import { Mochi, isBuilding } from 'mochi-framework';
globalThis.__test_isBuilding = isBuilding;
await Mochi.serve({ routes: {} });
throw new Error('serve should have halted execution before this line');`,
    );

    await extractServeOptions(entry);

    expect((globalThis as Record<string, unknown>).__test_isBuilding).toBe(true);
  });

  test('leaves the process unmarked, so queue adds still work afterwards', async () => {
    // The dev watcher extracts inside the running server on every entry rebuild; a process-wide `isBuilding` would
    // silently swallow every subsequent `queue.add()` for the rest of the dev session.
    const entry = writeEntry(`import { Mochi } from 'mochi-framework';
await Mochi.serve({ routes: {} });`);

    await extractServeOptions(entry);

    expect(isBuilding).toBe(false);
    const queue = Mochi.queue<{ n: number }>('after-extract');
    await startQueueRuntime('memory');
    await mountQueues([queue]);
    try {
      expect(await queue.add({ n: 1 })).toBeString();
    } finally {
      await closeAllQueueResources();
    }
  });

  test('returns null when the entry never calls serve()', async () => {
    const entry = writeEntry(`import { Mochi } from 'mochi-framework';
const _ = Mochi;`);

    expect(await extractServeOptions(entry)).toBeNull();
  });

  test('re-throws a genuine error from the entry', async () => {
    const entry = writeEntry(`throw new Error('boom');`);

    await expect(extractServeOptions(entry)).rejects.toThrow('boom');
  });

  test('throws when the entry swallows the halt sentinel and calls serve() again', async () => {
    const entry = writeEntry(`import { Mochi } from 'mochi-framework';
try { await Mochi.serve({ routes: {} }); } catch {}
await Mochi.serve({ routes: {} });`);

    await expect(extractServeOptions(entry)).rejects.toThrow('called more than once');
  });

  test('captures Mochi.standalone options without building or serving', async () => {
    const entry = writeEntry(`import { Mochi } from 'mochi-framework';
await Mochi.standalone({ port: 4100, routes: { '/': Mochi.page('./src/Home.svelte', { clientProps: () => ({ n: 1 }) }) } });
throw new Error('standalone should have halted execution before this line');`);

    const options = await extractStandaloneOptions(entry);

    expect(options).not.toBeNull();
    expect(options?.port).toBe(4100);
    expect(options?.routes['/']?.componentPath).toBe('./src/Home.svelte');
    expect(typeof options?.routes['/']?.clientProps).toBe('function');
  });

  test('extractServeOptions returns null for a standalone entry, and vice versa', async () => {
    const entry = writeEntry(`import { Mochi } from 'mochi-framework';
await Mochi.standalone({ routes: { '/': Mochi.page('./src/Home.svelte') } });`);
    expect(await extractServeOptions(entry)).toBeNull();

    const serveEntry = writeSecondEntry(`import { Mochi } from 'mochi-framework';
await Mochi.serve({ routes: {} });`);
    expect(await extractStandaloneOptions(serveEntry)).toBeNull();
  });
});
