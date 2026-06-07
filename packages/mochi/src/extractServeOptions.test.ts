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
await Mochi.serve({ optimize: { enabled: true, exclude: ['x.svelte'], report: true }, routes: {} });
throw new Error('serve should have halted execution before this line');`,
    );

    const options = await extractServeOptions(entry);

    expect(options).not.toBeNull();
    expect(options?.optimize).toEqual({ enabled: true, exclude: ['x.svelte'], report: true });
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
});
