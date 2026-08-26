import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createCompiledModuleLoader, isAppModulePath, type CompiledContext } from './compiledLoader';
import { resetCompiledEvaluationCache } from './compiledTwin';
import { toPosixPath } from '../utils/index';

let outDir: string;

const FRAMEWORK_SRC = path.join(import.meta.dir, '..');

function context(): CompiledContext {
  return { outDir, development: true, isPrebuilt: () => false, onUsage: () => {} };
}

beforeAll(() => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-loader-'));
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

// The root is injected here so the Windows case is reachable from any platform: on Linux `path.sep` is already `/`,
// so a real-path test can never exercise the separator mismatch that broke every Windows build.
describe('isAppModulePath', () => {
  const WIN_SRC = 'D:\\a\\mochi\\mochi\\packages\\mochi\\src';

  test('excludes framework paths whichever separator each side uses', () => {
    // How the client build actually spells its synthetic entrypoints on Windows: POSIX path, native root.
    expect(isAppModulePath('D:/a/mochi/mochi/packages/mochi/src/_hydrate-BackLink_a77hw5w5b52b.js', WIN_SRC)).toBe(false);
    expect(isAppModulePath('D:\\a\\mochi\\mochi\\packages\\mochi\\src\\compiled.ts', WIN_SRC)).toBe(false);
    expect(isAppModulePath('/repo/packages/mochi/src/compiled.ts', '/repo/packages/mochi/src')).toBe(false);
  });

  test('excludes dependencies whichever separator is used', () => {
    expect(isAppModulePath('D:\\app\\node_modules\\pkg\\index.js', WIN_SRC)).toBe(false);
    expect(isAppModulePath('/app/node_modules/pkg/index.js', '/repo/packages/mochi/src')).toBe(false);
  });

  test('admits app code, and does not treat a sibling directory as inside the framework', () => {
    expect(isAppModulePath('D:\\a\\mochi\\mochi\\packages\\site\\src\\app.ts', WIN_SRC)).toBe(true);
    // `…/mochi/src-other` must not match `…/mochi/src` by prefix alone.
    expect(isAppModulePath('D:/a/mochi/mochi/packages/mochi/src-other/app.ts', WIN_SRC)).toBe(true);
  });
});

describe('createCompiledModuleLoader', () => {
  // The client build gives its synthetic island entrypoints forward-slash paths under the framework's own src/, even
  // on Windows. Comparing with native separators missed them there, so the loader tried to read a file that only ever
  // existed in the bundler's `files` map and failed every Windows build with ENOENT.
  test('skips the client build synthetic island entrypoints, POSIX-style path and all', async () => {
    const load = createCompiledModuleLoader(context());
    const entryPath = toPosixPath(path.join(FRAMEWORK_SRC, '_hydrate-BackLink_a77hw5w5b52b.js'));
    expect(await load({ path: entryPath })).toBeUndefined();
  });

  test('skips the framework source itself, which mentions compiled() in prose', async () => {
    const load = createCompiledModuleLoader(context());
    expect(await load({ path: path.join(FRAMEWORK_SRC, 'compiled.ts') })).toBeUndefined();
    expect(await load({ path: toPosixPath(path.join(FRAMEWORK_SRC, 'compiled.ts')) })).toBeUndefined();
  });

  test('skips dependencies', async () => {
    const load = createCompiledModuleLoader(context());
    expect(await load({ path: path.join(outDir, 'node_modules', 'pkg', 'index.js') })).toBeUndefined();
  });

  // Any module the bundler supplies virtually shares this shape, so a missing file must fall through, not throw.
  test('falls through for an app-path module with nothing on disk', async () => {
    const load = createCompiledModuleLoader(context());
    expect(await load({ path: path.join(outDir, 'app', 'does-not-exist.ts') })).toBeUndefined();
  });

  test('still transforms a real app module', async () => {
    const file = path.join(outDir, 'app', 'value.ts');
    await Bun.write(file, `import { compiled } from 'mochi-framework';\nexport const v = await compiled(() => 6 * 7);\n`);
    const result = await createCompiledModuleLoader(context())({ path: file });
    expect(result?.loader).toBe('ts');
    expect(result?.contents).toContain('export const v = 42');
  });

  test('leaves an app module without the macro to the default loader', async () => {
    const file = path.join(outDir, 'app', 'plain.ts');
    await Bun.write(file, `export const v = 1;\n`);
    expect(await createCompiledModuleLoader(context())({ path: file })).toBeUndefined();
  });

  // `.svelte.ts` matches this loader's extension filter but belongs to the runes-module loader registered after it.
  // Claiming it here meant `$state` reached the bundle uncompiled.
  test('declines a runes module so the Svelte module loader can claim it', async () => {
    const file = path.join(outDir, 'app', 'state.svelte.ts');
    await Bun.write(file, `import { compiled } from 'mochi-framework';\nexport const v = await compiled(() => 1);\nexport const s = $state(null);\n`);
    expect(await createCompiledModuleLoader(context())({ path: file })).toBeUndefined();
    expect(await createCompiledModuleLoader(context())({ path: toPosixPath(file) })).toBeUndefined();
  });
});
