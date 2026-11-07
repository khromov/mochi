import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils/index';
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

const logsOf = (result: Awaited<ReturnType<typeof buildForBrowser>>) => result.logs.map((l) => String(l.message ?? l)).join('\n');

const SERVER_ONLY_CASES = [
  ['extensions', path.join(SRC_DIR, 'extensions'), 'hooks and filters', 'extensions'],
  ['mochiConfig', path.join(SRC_DIR, 'mochiConfig'), 'the Mochi.serve() config singleton', 'mochiConfig'],
  ['requestContext', path.join(SRC_DIR, 'runtime', 'requestContext'), 'the request context', 'runtime/requestContext'],
  ['env', path.join(SRC_DIR, 'utils', 'env'), 'the dev-mode flag', 'utils/env'],
] as const;

const USER_MODULE_CASES = ['extensions', 'env'];

// Bun caches a directory's entries per process, so a fixture written into a directory an earlier
// build already scanned intermittently resolves as if it were never created — every fixture goes to
// disk before the first build runs.
beforeAll(() => {
  for (const [name, target] of SERVER_ONLY_CASES) {
    fixture(`imports-${name}.ts`, `import * as m from '${toPosixPath(path.relative(tmpDir, target))}';\nexport default m;\n`);
  }
  for (const name of USER_MODULE_CASES) {
    fixture(`lib/${name}.ts`, `export const mine = 'ok-${name}';\n`);
    fixture(`imports-user-${name}.ts`, `import { mine } from './lib/${name}';\nexport default mine;\n`);
  }
});

describe('serverOnlyModuleGuard', () => {
  test.each(SERVER_ONLY_CASES)('fails the client build for %s', async (name, _target, label, displayPath) => {
    const result = await buildForBrowser(path.join(tmpDir, `imports-${name}.ts`));

    expect(result.success).toBe(false);
    const messages = logsOf(result);
    expect(messages).toContain(`src/${displayPath}.ts is server-only (${label})`);
    expect(messages).toContain(`imports-${name}.ts`);
    // Paths in user-facing output are always POSIX, on every platform.
    expect(messages).not.toContain('\\');
  });

  test.each(USER_MODULE_CASES)('a user module that merely shares the basename %s resolves normally', async (name) => {
    const result = await buildForBrowser(path.join(tmpDir, `imports-user-${name}.ts`));

    expect(logsOf(result)).toBe('');
    expect(result.success).toBe(true);
    expect(await result.outputs[0]!.text()).toContain(`ok-${name}`);
  });
});
