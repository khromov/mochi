import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { isBrowser, isDev, isServer, resolveEnvDev, SEEDED_IS_DEV, setDevelopment } from './env';
import { toPosixPath } from './index';

const tmpDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-env-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveEnvDev', () => {
  test('is true for NODE_ENV=development', () => {
    expect(resolveEnvDev({ NODE_ENV: 'development' })).toBe(true);
  });

  // Fails closed: `bun run start` leaves NODE_ENV unset and `bun test` sets it to "test", so anything short of an
  // explicit development signal must not turn dev-only branches on before Mochi.serve() resolves the real value.
  test.each([{}, { NODE_ENV: undefined }, { NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: 'dev' }])('is false for %o', (env) => {
    expect(resolveEnvDev(env)).toBe(false);
  });
});

describe('render-target constants', () => {
  test('the real module is the server one', () => {
    expect(isServer).toBe(true);
    expect(isBrowser).toBe(false);
  });

  // A literal `true` would narrow `if (isBrowser)` to `never` in user code.
  test('are typed boolean, not literal', () => {
    const widened: boolean = isServer;
    expect(widened).toBe(true);
  });
});

describe('setDevelopment', () => {
  test('seeds from the env before it is called', () => {
    expect(SEEDED_IS_DEV).toBe(resolveEnvDev(process.env));
    expect(isDev).toBe(SEEDED_IS_DEV);
  });

  // Importers see the update through the ESM live binding, which is the whole point of `export let` here.
  test('the live binding tracks the resolved mode', () => {
    setDevelopment(true);
    expect(isDev).toBe(true);

    setDevelopment(false);
    expect(isDev).toBe(false);
  });
});

// The hazard `pinGlobal` exists for: a second resolved copy of the framework (a non-hoisted install, an SSR chunk
// bundling framework sources by absolute path) must not keep serving the seed after Mochi.serve() resolved the mode.
describe('a duplicate copy of the module', () => {
  test('tracks setDevelopment() called on the other copy', async () => {
    const copyDir = path.join(tmpDir, 'copy');
    await Bun.$`mkdir -p ${copyDir}`.quiet();
    for (const file of ['env.ts', 'globalState.ts', 'serverOnly.ts', 'log.ts']) {
      await Bun.write(path.join(copyDir, file), await Bun.file(path.join(import.meta.dir, file)).text());
    }
    const probeFile = path.join(tmpDir, 'duplicate.ts');
    await Bun.write(
      probeFile,
      `import { setDevelopment } from ${JSON.stringify(toPosixPath(path.join(import.meta.dir, 'env.ts')))};\n` +
        `import * as copy from ${JSON.stringify(toPosixPath(path.join(copyDir, 'env.ts')))};\n` +
        `const before = copy.isDev;\n` +
        `setDevelopment(true);\n` +
        `console.log(JSON.stringify({ before, after: copy.isDev }));\n`,
    );
    const proc = Bun.spawn([process.execPath, probeFile], { env: { ...process.env, NODE_ENV: undefined }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`duplicate-copy probe exited with ${exitCode}\n${stderr}`);
    }
    expect(JSON.parse(stdout)).toEqual({ before: false, after: true });
  });
});

// The seed is captured at module load, so each case needs its own process.
describe('seeding in a fresh process', () => {
  async function probe(name: string, env: Record<string, string | undefined>): Promise<{ seeded: boolean; stderr: string }> {
    const file = path.join(tmpDir, `${name}.ts`);
    await Bun.write(
      file,
      `import { SEEDED_IS_DEV, setDevelopment } from ${JSON.stringify(toPosixPath(path.join(import.meta.dir, 'env.ts')))};\n` +
        `setDevelopment(false, { warnOnEnvMismatch: true });\n` +
        `console.log(JSON.stringify({ seeded: SEEDED_IS_DEV }));\n`,
    );
    const proc = Bun.spawn([process.execPath, file], {
      env: { ...process.env, NODE_ENV: undefined, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    // Checked before parsing: a child that dies on import writes nothing to stdout, and JSON.parse('') would bury the
    // real cause sitting in stderr behind a syntax error.
    if (exitCode !== 0) {
      throw new Error(`probe "${name}" exited with ${exitCode}\n${stderr}`);
    }
    return { seeded: (JSON.parse(stdout) as { seeded: boolean }).seeded, stderr };
  }

  test('NODE_ENV=development seeds true and warns when serve disagrees', async () => {
    const { seeded, stderr } = await probe('dev', { NODE_ENV: 'development' });
    expect(seeded).toBe(true);
    expect(stderr).toContain('NODE_ENV is "development"');
  });

  // The quiet direction: Mochi.serve() defaults development to true, so warning here would fire on every plain boot.
  test('an unset env seeds false and stays silent', async () => {
    const { seeded, stderr } = await probe('unset', {});
    expect(seeded).toBe(false);
    expect(stderr).not.toContain('NODE_ENV is "development"');
  });
});
