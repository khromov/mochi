import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { encodeDebugBarGlobals } from './debugBarEncode';

const PAGE = path.join(import.meta.dir, '__fixtures__', 'DebugBarPage.svelte');

// Evaluate the client-side decode expression the way a browser would, to prove the round-trip.
function decodeEmittedGlobal(transformedHtml: string, name: string): unknown {
  const m = transformedHtml.match(new RegExp(`<script>window\\.${name}=(.+?)</script>`));
  if (!m) {
    throw new Error(`no transformed <script> for window.${name}`);
  }
  // The RHS uses atob/TextDecoder/Uint8Array — all available as Bun globals — so eval matches the browser.
  // oxlint-disable-next-line no-eval
  return eval(m[1]!);
}

describe('encodeDebugBarGlobals', () => {
  test('round-trips the payload through the emitted client decode expression', () => {
    const value = { paths: ['../mochi/src/cookies.client.ts'], emoji: '🍡', nested: { a: 1 } };
    const json = JSON.stringify(value);
    const html = `<head><script>window.__mochi_debug=${json}</script></head>`;

    const { html: out, matched } = encodeDebugBarGlobals(html);

    expect(matched).toBe(1);
    expect(decodeEmittedGlobal(out, '__mochi_debug')).toEqual(value);
  });

  test('encoded payload contains no slash — the whole point of base64url', () => {
    const json = JSON.stringify({ p: '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p' });
    const { html: out } = encodeDebugBarGlobals(`<script>window.__mochi_debug=${json}</script>`);
    const payload = out.match(/atob\("([^"]*)"/)![1];
    expect(payload).not.toContain('/');
  });

  test('matched is 0 when no debug globals are present', () => {
    expect(encodeDebugBarGlobals('<html><body>hi</body></html>').matched).toBe(0);
  });
});

// Regression guard: the regex depends on the framework's exact `<script>window.<name>=…</script>`
// emission, so boot a real Mochi dev server and assert we still match. If the framework ever
// changes that format, this fails instead of silently leaking URLs.
describe('encodeDebugBarGlobals against real framework output', () => {
  let server: Server<undefined>;
  let outDir: string;
  let pageHtml: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-debugbar-encode-'));
    server = await Mochi.serve({
      port: 0,
      development: true,
      logger: { enabled: false },
      outDir,
      routes: { '/page': Mochi.page(PAGE) },
    });
    const res = await fetch(`http://localhost:${server.port}/page`);
    pageHtml = await res.text();
    expect(res.status).toBe(200);
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('the framework still emits a matchable window.__mochi_debug script', () => {
    expect(pageHtml).toContain('window.__mochi_debug=');
    const { matched } = encodeDebugBarGlobals(pageHtml);
    expect(matched).toBeGreaterThanOrEqual(1);
  });
});
