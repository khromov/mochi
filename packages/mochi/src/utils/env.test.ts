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
  test.each([{ MODE: 'development' }, { NODE_ENV: 'development' }])('is true for %o', (env) => {
    expect(resolveEnvDev(env)).toBe(true);
  });

  // Fails closed: `bun run start` sets neither variable, so anything short of an explicit development signal
  // must not turn dev-only branches on before Mochi.serve() resolves the real value.
  test.each([{}, { MODE: 'production' }, { NODE_ENV: 'production' }, { MODE: 'test' }, { MODE: undefined, NODE_ENV: undefined }])('is false for %o', (env) => {
    expect(resolveEnvDev(env)).toBe(false);
  });

  test('MODE wins over NODE_ENV when both are set', () => {
    expect(resolveEnvDev({ MODE: 'production', NODE_ENV: 'development' })).toBe(false);
    expect(resolveEnvDev({ MODE: 'development', NODE_ENV: 'production' })).toBe(true);
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
      env: { ...process.env, MODE: undefined, NODE_ENV: undefined, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return { seeded: (JSON.parse(stdout) as { seeded: boolean }).seeded, stderr };
  }

  test('MODE=development seeds true and warns when serve disagrees', async () => {
    const { seeded, stderr } = await probe('dev', { MODE: 'development' });
    expect(seeded).toBe(true);
    expect(stderr).toContain('MODE (or NODE_ENV) says "development"');
  });

  // The quiet direction: Mochi.serve() defaults development to true, so warning here would fire on every plain boot.
  test('an unset env seeds false and stays silent', async () => {
    const { seeded, stderr } = await probe('unset', {});
    expect(seeded).toBe(false);
    expect(stderr).not.toContain('MODE (or NODE_ENV)');
  });
});
