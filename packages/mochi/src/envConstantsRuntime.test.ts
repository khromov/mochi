import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
// Imported before Mochi.serve() below, exactly as an app entry imports its routes.
import { atModuleLoad, readNow } from './__fixtures__/env-constants/data.server';
import { isDev, resolveEnvDev } from './utils/env';
import { toPosixPath } from './utils';

// Dedicated file: setDevelopment() is process-wide, and Mochi.serve() may only be called once per process.
describe('env constants in unbundled server code', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let devAtInitHook: boolean | undefined;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-env-constants-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      eventHooks: {
        'mochi:init': () => {
          devAtInitHook = isDev;
        },
      },
      routes: {
        '/env': Mochi.api(() => Response.json(readNow())),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  // The regression: this import used to resolve to a package with no such exports.
  test('a .server.ts can import the constants without a build step', () => {
    expect(atModuleLoad.isServer).toBe(true);
    expect(atModuleLoad.isBrowser).toBe(false);
  });

  test('module-load reads fall back to the env seed', () => {
    expect(atModuleLoad.isDev).toBe(resolveEnvDev(process.env));
  });

  // Unlike an app's module top level, `mochi:init` runs inside serve() — it has no reason to see the stale seed.
  test('a mochi:init hook sees the mode Mochi.serve() resolved', () => {
    expect(devAtInitHook).toBe(true);
  });

  test('reads during a request see the mode Mochi.serve() resolved', async () => {
    const res = await fetch(`${base}/env`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isDev: true, isServer: true, isBrowser: false });
  });

  // Its own process: this needs a second Mochi.serve() and a different NODE_ENV than the boot above.
  test('the env-mismatch warning is not swallowed by a configured logger level', async () => {
    const probeOutDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-env-mismatch-'));
    const probeFile = path.join(probeOutDir, 'probe.ts');
    await Bun.write(
      probeFile,
      `import { Mochi } from ${JSON.stringify(toPosixPath(path.join(import.meta.dir, 'Mochi.ts')))};\n` +
        `const server = await Mochi.serve({\n` +
        `  port: 0,\n` +
        `  development: false,\n` +
        `  logger: { level: 'error' },\n` +
        `  outDir: ${JSON.stringify(toPosixPath(probeOutDir))},\n` +
        `  routes: {},\n` +
        `});\n` +
        `server.stop(true);\n`,
    );
    const proc = Bun.spawn([process.execPath, probeFile], {
      env: { ...process.env, NODE_ENV: 'development' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    rmSync(probeOutDir, { recursive: true, force: true });
    if (exitCode !== 0) {
      throw new Error(`probe exited with ${exitCode}\n${stderr}`);
    }
    expect(stderr + stdout).toContain('NODE_ENV is "development"');
    // The configured level is still honoured for everything after it.
    expect(stderr + stdout).not.toContain('Starting in production mode');
  }, 30_000);
});
