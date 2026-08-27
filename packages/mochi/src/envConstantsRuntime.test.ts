import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
// Imported before Mochi.serve() below, exactly as an app entry imports its routes.
import { atModuleLoad, readNow } from './__fixtures__/env-constants/data.server';
import { resolveEnvDev } from './utils/env';

// Dedicated file: setDevelopment() is process-wide, and Mochi.serve() may only be called once per process.
describe('env constants in unbundled server code', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-env-constants-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
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

  test('reads during a request see the mode Mochi.serve() resolved', async () => {
    const res = await fetch(`${base}/env`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isDev: true, isServer: true, isBrowser: false });
  });
});
