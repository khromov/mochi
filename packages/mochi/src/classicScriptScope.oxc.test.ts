// The `minifier: 'oxc'` half of `classicScriptScope.test.ts`. oxc is the reason these checks exist: in module mode it
// renames top-level bindings to one-letter names, which is exactly what turns a classic script's global lexical
// declaration into a likely collision, so the inline scripts are minified in script mode instead.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { classicScripts, moduleSyntax, topLevelDeclarations } from './__fixtures__/classic-scripts/assertions';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'live-reload-filter');

let server: Server<undefined>;
let outDir: string;
let html: string;

describe("inline classic scripts (minifier: 'oxc')", () => {
  beforeAll(async () => {
    // Set before `Mochi` is imported: the registry resolves the minifier at construction.
    process.env.MOCHI_MINIFIER = 'oxc';
    const { Mochi } = await import('./Mochi');
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-classic-scope-oxc-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      routes: { '/': Mochi.page(path.join(FIXTURE_DIR, 'PageA.svelte')) },
    });
    html = await (await fetch(`http://localhost:${server.port}/`)).text();
  });

  afterAll(() => {
    server?.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    delete process.env.MOCHI_MINIFIER;
  });

  test('oxc really did run, so the checks below are not testing the bun path', async () => {
    // Guards the rest of this file against passing vacuously: rebuild the same entry with the env override lifted and
    // assert the page is not serving that. The env var wins over the argument, so it has to be cleared, not overridden.
    const { buildInlineWebComponent } = await import('./compiler/buildInlineWebComponent');
    delete process.env.MOCHI_MINIFIER;
    const bunJs = await buildInlineWebComponent('./web-components/LiveReload.ts', 'bun');
    process.env.MOCHI_MINIFIER = 'oxc';

    const inlineLiveReload = classicScripts(html).find((s) => s.includes('mochi-live-reload'))!;

    expect(inlineLiveReload.includes(bunJs)).toBe(false);
    expect(inlineLiveReload.length).toBeLessThan(bunJs.length);
  });

  test('none declares a top-level binding that another classic script could collide with', () => {
    for (const body of classicScripts(html)) {
      expect(topLevelDeclarations(body)).toEqual([]);
    }
  });

  test('the live-reload script is IIFE-wrapped, not injected bare', () => {
    const liveReload = classicScripts(html).find((s) => s.includes('mochi-live-reload'));
    expect(liveReload).toBeDefined();
    expect(liveReload!.startsWith('(()=>{')).toBe(true);
  });

  test('none contains module syntax, which a classic script cannot run', () => {
    for (const body of classicScripts(html)) {
      expect(moduleSyntax(body)).toEqual({ imports: [], exports: [] });
    }
  });

  test('every inline classic script parses standalone as a script, not only as a module', () => {
    for (const body of classicScripts(html)) {
      expect(() => new Function(body)).not.toThrow();
    }
  });
});
