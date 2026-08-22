import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compile } from '@tailwindcss/node';
import { createBunResolver } from './tailwind';

describe('createBunResolver', () => {
  test('resolves a real module id to a clean absolute path', async () => {
    const resolver = createBunResolver();
    const resolved = (await resolver('@tailwindcss/node', import.meta.dir)) as string;
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.split(path.sep).join('/')).toContain('/@tailwindcss/node/');
    // "Clean" means no enhanced-resolve `\0#` escape artifacts — the path must be readable as-is.
    expect(resolved).not.toContain('\0');
    expect(existsSync(resolved)).toBe(true);
  });

  test('resolves a relative @import inside compile() from a base dir containing # and space', async () => {
    const hashDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-tw-# hash-'));
    try {
      writeFileSync(path.join(hashDir, 'imported.css'), '.from-imported { color: rebeccapurple; }\n');
      const compiled = await compile(`@import './imported.css';\n`, {
        base: hashDir,
        from: path.join(hashDir, 'input.css'),
        onDependency: () => {},
        customCssResolver: createBunResolver(),
      });
      expect(compiled.build([])).toContain('rebeccapurple');
    } finally {
      rmSync(hashDir, { recursive: true, force: true });
    }
  });

  test('returns undefined (never throws) for an unresolvable id', async () => {
    const resolver = createBunResolver();
    // Must not reject: a thrown error would abort Tailwind's compile instead of
    // letting it fall back to the default resolver.
    expect(await resolver('this-package-does-not-exist-xyz', import.meta.dir)).toBeUndefined();
  });
});

// Locks in the assumption the Bun resolver relies on: Tailwind only uses a custom
// resolver's return value when it's truthy, otherwise it falls back to its own
// (enhanced-resolve) resolver. A resolver that always returns undefined must therefore
// still resolve a relative @import via the default. If this ever regresses, the `#`/space
// install-path fix would silently start dropping every import Bun can't resolve.
describe('Tailwind defers to its default resolver on a falsy custom-resolver return', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-tw-resolver-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('undefined return falls through to the default resolver', async () => {
    writeFileSync(path.join(dir, 'imported.css'), '.from-imported { color: rebeccapurple; }\n');
    const compiled = await compile(`@import './imported.css';\n`, {
      base: dir,
      from: path.join(dir, 'input.css'),
      onDependency: () => {},
      customCssResolver: async () => undefined,
    });
    expect(compiled.build([])).toContain('rebeccapurple');
  });
});
