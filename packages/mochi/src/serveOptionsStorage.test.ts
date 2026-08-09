// Boots a real Mochi.serve({ optionsStorage }) end-to-end. Only one Mochi.serve() is allowed per process, so the
// boot-rejection cases run first (they throw before initMochiConfig pins the singleton) and a single server covers
// the rest. The page route's .svelte import of MochiOptions is the only coverage of the mochi-env virtual-module
// re-export — typecheck and unit tests can't catch a missing entry there.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { MochiOptions, closeOptionsStorage } from './options';

describe('Mochi.serve({ optionsStorage })', () => {
  let server: Server<undefined>;
  let tmpDir: string;
  let base: string;

  afterAll(async () => {
    await server?.stop(true);
    await closeOptionsStorage();
    // Windows releases SQLite file locks asynchronously, so an immediate rm can throw EBUSY. (Bun ignores rmSync's
    // maxRetries option, so retry by hand.) Best-effort cleanup of an ephemeral temp dir — never fail the suite over it.
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
        return;
      } catch {
        await Bun.sleep(100);
      }
    }
  });

  test("rejects optionsStorage: 'memory' before binding", async () => {
    await expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        optionsStorage: 'memory' as never,
      }),
    ).rejects.toThrow(/options have no memory backend/);
  });

  test('rejects a malformed optionsStorage before binding', async () => {
    await expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        optionsStorage: { sqlite: '' },
      }),
    ).rejects.toThrow(`Mochi.serve({ optionsStorage }): expected { sqlite: 'path/to.db' }, { postgres: url }, or { pglite: instance }.`);
  });

  test('rejects an optionsStorage naming both backends before binding', async () => {
    await expect(
      Mochi.serve({
        port: 0,
        development: false,
        logger: { enabled: false },
        routes: {},
        optionsStorage: { sqlite: 'options.db', postgres: 'postgres://localhost/db' } as never,
      }),
    ).rejects.toThrow(/optionsStorage/);
  });

  test('boots on sqlite storage; API routes and .svelte imports reach the store', async () => {
    tmpDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-options-'));
    const outDir = path.join(tmpDir, 'out');
    mkdirSync(outDir);
    const dbFile = path.join(tmpDir, 'options.db');
    const pagePath = path.join(tmpDir, 'OptionsPage.svelte');
    writeFileSync(
      pagePath,
      "<script>\n  import { MochiOptions } from 'mochi-framework';\n  const pending = MochiOptions.get('greeting', 'fallback');\n</script>\n\n<h1>options page</h1>\n",
    );

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      optionsStorage: { sqlite: dbFile },
      routes: {
        '/': Mochi.page(pagePath),
        '/api/options': Mochi.api(async () => {
          await MochiOptions.set('greeting', 'hello');
          const afterSet = await MochiOptions.get('greeting');
          let dupError: string | null = null;
          try {
            await MochiOptions.set('greeting', 'again');
          } catch (err) {
            dupError = err instanceof Error ? err.message : String(err);
          }
          await MochiOptions.update('greeting', { when: new Date(0) });
          const afterUpdate = await MochiOptions.get<{ when: Date }>('greeting');
          const deleted = await MochiOptions.delete('greeting');
          const afterDelete = await MochiOptions.get('greeting', 'gone');
          return Response.json({
            afterSet,
            dupError,
            updatedIsDate: afterUpdate?.when instanceof Date && afterUpdate.when.getTime() === 0,
            deleted,
            afterDelete,
          });
        }),
      },
    });
    base = `http://localhost:${server.port}`;

    const api = await fetch(`${base}/api/options`);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({
      afterSet: 'hello',
      dupError: 'MochiOptions.set("greeting"): the key already exists. set() is insert-only — use MochiOptions.update() to overwrite, or delete() it first.',
      updatedIsDate: true,
      deleted: true,
      afterDelete: 'gone',
    });
    expect(existsSync(dbFile)).toBe(true);
  }, 30_000);

  test('a page whose component imports MochiOptions from mochi-framework renders', async () => {
    const page = await fetch(`${base}/`);
    const body = await page.text();
    expect(page.status).toBe(200);
    expect(body).toContain('options page');
  }, 30_000);
});
