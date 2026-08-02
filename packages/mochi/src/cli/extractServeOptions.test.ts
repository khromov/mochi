import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractServeOptions } from './extractServeOptions';

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
  });

  function writeEntry(body: string): string {
    dir = mkdtempSync(path.join(tmpdir(), 'extract-serve-'));
    const entry = path.join(dir, 'entry.ts');
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

  test('captures the jobs descriptor without booting a worker', async () => {
    // Mochi.jobs() is inert config, so importing the entry for extraction must
    // not create a queuert client/worker (which would hang the build). The test
    // simply completing proves nothing kept the event loop alive.
    const entry = writeEntry(
      `import { Mochi, defineJobTypes } from 'mochi-framework';
const jobs = Mochi.jobs({
  types: defineJobTypes(),
  processors: { send: { attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })) } },
  concurrency: 2,
});
await Mochi.serve({ routes: {}, jobs });
throw new Error('serve should have halted execution before this line');`,
    );

    const options = await extractServeOptions(entry);

    expect(options?.jobs).toBeDefined();
    expect(options?.jobs?.__mochiJobs).toBe(true);
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
});
