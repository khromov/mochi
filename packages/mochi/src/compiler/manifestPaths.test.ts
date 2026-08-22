// The source-path codec is half of the manifest's relocation guarantee, and
// both halves have to agree exactly: encode runs at build time against the
// building process's roots, decode at boot against the serving process's. A
// disagreement doesn't crash — it silently misses the manifest and recompiles.
import { describe, expect, spyOn, test } from 'bun:test';
import path from 'node:path';
import { decodeSourcePath, encodeSourcePath, FRAMEWORK_PREFIX } from './manifestPaths';
import { logger } from '../utils/log';

const ROOT = path.resolve('/project');
const SRC = path.resolve('/framework/src');

describe('encodeSourcePath', () => {
  test('makes a path under the project root relative', () => {
    expect(encodeSourcePath(path.join(ROOT, 'src/Page.svelte'), ROOT, SRC)).toBe('src/Page.svelte');
  });

  test('accepts the path the caller wrote, resolved or not', () => {
    const cwd = process.cwd();
    expect(encodeSourcePath('./src/Page.svelte', cwd, SRC)).toBe('src/Page.svelte');
    expect(encodeSourcePath(path.join(cwd, 'src/Page.svelte'), cwd, SRC)).toBe('src/Page.svelte');
  });

  test('keeps `..` for a source outside the project root', () => {
    // A monorepo sibling or a hoisted node_modules. Unlike an artifact escaping
    // the out-dir, this is normal and relocates fine — the relative structure
    // between the project and its dependencies is what a deploy preserves.
    expect(encodeSourcePath(path.resolve('/node_modules/pkg/X.svelte'), ROOT, SRC)).toBe('../node_modules/pkg/X.svelte');
  });

  test('marks framework-owned sources with the sentinel', () => {
    expect(encodeSourcePath(path.join(SRC, 'templates/DefaultError.svelte'), ROOT, SRC)).toBe(`${FRAMEWORK_PREFIX}templates/DefaultError.svelte`);
  });

  test('prefers the sentinel when the framework lives inside the project', () => {
    // The workspace-checkout layout, and this package's own test suite. The
    // framework root has to win, or the key would encode the checkout layout.
    const nested = path.join(ROOT, 'packages/mochi/src');
    expect(encodeSourcePath(path.join(nested, 'templates/DefaultError.svelte'), ROOT, nested)).toBe(`${FRAMEWORK_PREFIX}templates/DefaultError.svelte`);
  });

  test('emits POSIX separators', () => {
    const encoded = encodeSourcePath(path.join(ROOT, 'src', 'nested', 'Page.svelte'), ROOT, SRC);
    expect(encoded).toBe('src/nested/Page.svelte');
    expect(encoded).not.toContain('\\');
  });

  test.if(process.platform === 'win32')('falls back to absolute, loudly, across drives', () => {
    const warnSpy = spyOn(logger, 'warn');
    try {
      const encoded = encodeSourcePath('D:\\other\\Page.svelte', 'C:\\project', SRC);
      expect(path.isAbsolute(encoded)).toBe(true);
      expect(encoded).not.toContain('\\');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('will not relocate'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('decodeSourcePath', () => {
  test('round-trips a project source', () => {
    const abs = path.join(ROOT, 'src/Page.svelte');
    expect(decodeSourcePath(encodeSourcePath(abs, ROOT, SRC), ROOT, SRC)).toBe(abs);
  });

  test('round-trips a source outside the project root', () => {
    const abs = path.resolve('/node_modules/pkg/X.svelte');
    expect(decodeSourcePath(encodeSourcePath(abs, ROOT, SRC), ROOT, SRC)).toBe(abs);
  });

  test('re-anchors a framework source to wherever the framework now lives', () => {
    // The point of the sentinel: a build made in a workspace checkout has to
    // boot against a node_modules install, and vice versa.
    const built = encodeSourcePath(path.join(SRC, 'templates/DefaultError.svelte'), ROOT, SRC);
    const served = path.resolve('/app/node_modules/mochi-framework/src');
    expect(decodeSourcePath(built, ROOT, served)).toBe(path.join(served, 'templates/DefaultError.svelte'));
  });

  test('passes an absolute path through untouched', () => {
    // The cross-drive escape hatch above: unportable, but it must still load.
    const abs = path.resolve('/elsewhere/Page.svelte');
    expect(decodeSourcePath(abs, ROOT, SRC)).toBe(abs);
  });
});
