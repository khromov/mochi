import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';

const SRC_DIR = path.resolve(import.meta.dir, '..');
// A sibling of `src/` so relative specifiers can climb out to the real
// framework modules the guard is meant to catch.
const tmpDir = mkdtempSync(path.join(SRC_DIR, '..', '.mochi-server-only-guard-'));

afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function fixture(name: string, contents: string): string {
  const file = path.join(tmpDir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return file;
}

const buildForBrowser = (entry: string) =>
  Bun.build({
    entrypoints: [entry],
    plugins: [serverOnlyModuleGuard],
    target: 'browser',
    define: { ...CLIENT_BUILD_DEFINE },
    throw: false,
  });

describe('serverOnlyModuleGuard', () => {
  test.each([
    ['extensions', `${path.relative(tmpDir, path.join(SRC_DIR, 'extensions'))}`, 'hooks and filters'],
    ['mochiConfig', `${path.relative(tmpDir, path.join(SRC_DIR, 'mochiConfig'))}`, 'the Mochi.serve() config singleton'],
    ['requestContext', `${path.relative(tmpDir, path.join(SRC_DIR, 'runtime', 'requestContext'))}`, 'the request context'],
  ])('fails the client build for %s', async (name, specifier, label) => {
    const entry = fixture(`imports-${name}.ts`, `import * as m from '${specifier.replace(/\\/g, '/')}';\nexport default m;\n`);

    const result = await buildForBrowser(entry);

    expect(result.success).toBe(false);
    const messages = result.logs.map((l) => String(l.message ?? l)).join('\n');
    expect(messages).toContain(`src/${name === 'requestContext' ? 'runtime/requestContext' : name}.ts is server-only (${label})`);
    expect(messages).toContain(`imports-${name}.ts`);
    // Paths in user-facing output are always POSIX, on every platform.
    expect(messages).not.toContain('\\');
  });

  test('a user module that merely shares the basename resolves normally', async () => {
    fixture('lib/extensions.ts', `export const mine = 'ok';\n`);
    const entry = fixture('imports-user-extensions.ts', `import { mine } from './lib/extensions';\nexport default mine;\n`);

    const result = await buildForBrowser(entry);

    expect(result.success).toBe(true);
    expect(await result.outputs[0]!.text()).toContain('ok');
  });
});
