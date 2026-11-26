import { afterAll, beforeAll, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, getCspNonce } from './index';
import { headerNonce, isGated, scriptTags } from './__fixtures__/csp/scriptTags';

// Development adds the scripts production never ships: log level, warn shim, debug bar, live reload, and the font-subset check.
let server: Server<undefined>;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-csp-dev-'));
  mkdirSync(path.join(tmp, 'files'));
  copyFileSync(path.join(import.meta.dir, '__fixtures__', 'fonts', 'caveat-latin-wght-normal.woff2'), path.join(tmp, 'files', 'caveat-latin-wght-normal.woff2'));
  writeFileSync(path.join(tmp, 'font.css'), `@font-face {\n  font-family: 'Caveat Variable';\n  src: url(./files/caveat-latin-wght-normal.woff2) format('woff2-variations');\n}\n`);
  writeFileSync(
    path.join(tmp, 'Page.svelte'),
    `<script>\n  import './font.css' with { subset: 'Hello' };\n  import Probe from '${path.join(import.meta.dir, '__fixtures__', 'csp', 'Probe.svelte')}';\n<` +
      `/script>\n<p style="font-family: 'Caveat Variable'">Hello</p>\n<Probe mochi:hydrate label="dev" />\n`,
  );
  server = await Mochi.serve({
    port: 0,
    development: true,
    logger: { enabled: false },
    outDir: path.join(tmp, 'out'),
    csp: true,
    handle: async ({ event, resolve }) => {
      const response = await resolve(event);
      const nonce = getCspNonce();
      if (nonce) {
        response.headers.set('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
      }
      return response;
    },
    routes: { '/': Mochi.page(path.join(tmp, 'Page.svelte')) },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

test('every dev-only script carries the header nonce', async () => {
  const res = await fetch(`http://localhost:${server.port}/`);
  const nonce = headerNonce(res);
  expect(nonce).toBeTruthy();
  const tags = await scriptTags(await res.text());
  for (const tag of tags.filter(isGated)) {
    expect({ ...tag, text: tag.text.slice(0, 60) }).toMatchObject({ nonce });
  }
  for (const marker of [
    'window.__mochi_log_level',
    'window.__mochi_warnings',
    'window.__mochi_debug=',
    'window.__mochi_page_entry',
    'window.__mochi_asset_prefix',
    'window.__mochi_font_subsets',
    'font subset for',
    'mochi-live-reload',
    'Object.assign((window.__mochi_debug',
  ]) {
    expect(tags.find((t) => t.text.includes(marker))?.nonce).toBe(nonce!);
  }
  expect(tags.filter((t) => t.type === 'module' && t.src).length).toBeGreaterThanOrEqual(2);
});
