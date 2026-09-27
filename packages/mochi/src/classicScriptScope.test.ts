// Classic scripts on one page share one global lexical scope, so a top-level `let`/`const`/`class` in any of Mochi's
// inline scripts would be a SyntaxError against a same-named binding in any other.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { classicScripts, moduleSyntax, topLevelDeclarations } from './__fixtures__/classic-scripts/assertions';

const FIXTURE_DIR = path.join(import.meta.dir, '__fixtures__', 'live-reload-filter');

let server: Server<undefined>;
let outDir: string;
let html: string;

describe('inline classic scripts', () => {
  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-classic-scope-'));
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
  });

  test('the dev page really does carry several of them', () => {
    // Guards the rest of this file: if the shell stopped emitting inline scripts the checks below would pass vacuously.
    expect(classicScripts(html).length).toBeGreaterThanOrEqual(2);
  });

  test('none declares a top-level binding that another classic script could collide with', () => {
    for (const body of classicScripts(html)) {
      expect(topLevelDeclarations(body)).toEqual([]);
    }
  });

  test('the live-reload script is IIFE-wrapped, not injected bare', () => {
    expect(html).toContain('<mochi-live-reload>');
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
      // `new Function` uses the script goal, so module-only syntax or a stray top-level `await` throws here.
      expect(() => new Function(body)).not.toThrow();
    }
  });

  test('client JS is served with an explicit UTF-8 charset', async () => {
    // Bun emits raw UTF-8: emoji and accented characters survive unescaped in string literals. Without a
    // charset the browser falls back to the document's encoding instead of decoding the script as UTF-8.
    const js = html.match(/\/_mochi\/[^"'\s]+\.js/);
    expect(js).not.toBeNull();

    const res = await fetch(`http://localhost:${server.port}${js![0]}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
  });
});
