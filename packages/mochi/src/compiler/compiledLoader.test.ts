import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { applyCompiled, createCompiledModuleLoader, isAppModulePath, needsCompiledTransform, type CompiledContext } from './compiledLoader';
import { resetCompiledEvaluationCache } from './compiledTwin';
import { toPosixPath } from '../utils/index';

let outDir: string;

const FRAMEWORK_SRC = path.join(import.meta.dir, '..');

function context(development = false): CompiledContext {
  return { outDir, development, isPrebuilt: () => false, onUsage: () => {} };
}

beforeAll(() => {
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-compiled-loader-'));
});

afterAll(() => {
  resetCompiledEvaluationCache();
  rmSync(outDir, { recursive: true, force: true });
});

// The root is injected so the Windows separator mismatch is reachable from any platform.
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
  // Comparing with native separators missed these on Windows, so the loader tried to read a file that only ever existed in the bundler's `files` map.
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

  test('removes the twin once the value is evaluated', async () => {
    const file = path.join(outDir, 'app', 'tidy.ts');
    await Bun.write(file, `import { compiled } from 'mochi-framework';\nexport const v = await compiled(() => 'tidy');\n`);
    await createCompiledModuleLoader(context())({ path: file });
    expect(existsSync(path.join(outDir, 'compiled'))).toBe(false);
  });

  // Dev runs the function at request time through the runtime fallback, so nothing is inlined.
  test('leaves a compiled() call alone in dev', async () => {
    const file = path.join(outDir, 'app', 'dev.ts');
    await Bun.write(file, `import { compiled } from 'mochi-framework';\nexport const v = await compiled(() => 6 * 7);\n`);
    expect(await createCompiledModuleLoader(context(true))({ path: file })).toBeUndefined();
    const svelte = `<script>\n  import { compiled } from 'mochi-framework';\n  const v = await compiled(() => 1);\n</${'script'}>`;
    expect(await applyCompiled(svelte, path.join(outDir, 'app', 'Dev.svelte'), context(true))).toBe(svelte);
  });

  // A module ref only exists at build time, so this is the one shape that cannot fall back to the runtime in dev.
  test('still transforms a module that uses moduleRef() in dev', async () => {
    const file = path.join(outDir, 'app', 'refs.ts');
    await Bun.write(file, `import { compiled, moduleRef } from 'mochi-framework';\nexport const v = await compiled(() => ({ a: moduleRef('./a.svelte') }));\n`);
    const result = await createCompiledModuleLoader(context(true))({ path: file });
    expect(result?.contents).toContain(`import __mochi_ref_0__ from "./a.svelte"`);
  });
});

describe('needsCompiledTransform', () => {
  test('gates on the macro, then on dev and moduleRef', () => {
    expect(needsCompiledTransform('export const a = 1;', { development: false })).toBe(false);
    expect(needsCompiledTransform('compiled(() => 1)', { development: false })).toBe(true);
    expect(needsCompiledTransform('compiled(() => 1)', { development: true })).toBe(false);
    expect(needsCompiledTransform('compiled(() => moduleRef("./x"))', { development: true })).toBe(true);
  });

  // `.svelte.ts` matches this loader's filter but belongs to the runes loader; claiming it here meant `$state` reached the bundle uncompiled.
  test('declines a runes module so the Svelte module loader can claim it', async () => {
    const file = path.join(outDir, 'app', 'state.svelte.ts');
    await Bun.write(file, `import { compiled } from 'mochi-framework';\nexport const v = await compiled(() => 1);\nexport const s = $state(null);\n`);
    expect(await createCompiledModuleLoader(context())({ path: file })).toBeUndefined();
    expect(await createCompiledModuleLoader(context())({ path: toPosixPath(file) })).toBeUndefined();
  });
});
