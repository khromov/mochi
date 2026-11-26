import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi, getCspNonce } from './index';
import { headerNonce, isGated, scriptTags } from './__fixtures__/csp/scriptTags';

const FIXTURES = path.join(import.meta.dir, '__fixtures__', 'csp');

describe('csp: true in production', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-csp-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      csp: true,
      // Each of these makes the shell emit one more inline script that needs the nonce.
      filters: { 'cookie:defaults': () => ({ sameSite: 'Lax', path: '/' }) },
      speculationRules: { prefetch: [{ where: { href_matches: '/*' }, eagerness: 'moderate' }] },
      handle: async ({ event, resolve }) => {
        const response = await resolve(event);
        const nonce = getCspNonce();
        if (nonce) {
          response.headers.set('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
        }
        return response;
      },
      routes: {
        '/page': Mochi.page(path.join(FIXTURES, 'Page.svelte')),
        '/throws': Mochi.page(path.join(FIXTURES, 'Throws.svelte')),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  async function expectAllGatedScriptsNonced(res: Response): Promise<{ nonce: string; html: string }> {
    const nonce = headerNonce(res);
    expect(nonce).toBeTruthy();
    const html = await res.text();
    const gated = (await scriptTags(html)).filter(isGated);
    expect(gated.length).toBeGreaterThan(0);
    for (const tag of gated) {
      expect({ ...tag, text: tag.text.slice(0, 60) }).toMatchObject({ nonce });
    }
    return { nonce: nonce!, html };
  }

  test('every script a page carries has the header nonce, data blocks excepted', async () => {
    const { nonce, html } = await expectAllGatedScriptsNonced(await fetch(`${base}/page`));
    const tags = await scriptTags(html);
    const textOf = (marker: string) => tags.find((t) => t.text.includes(marker));
    expect(textOf('window.__mochi_cookie_defaults')?.nonce).toBe(nonce);
    expect(textOf('frozen-on-server')?.nonce).toBe(nonce);
    expect(tags.find((t) => t.type === 'speculationrules')?.nonce).toBe(nonce);
    expect(tags.find((t) => t.type === 'module' && t.src)?.nonce).toBe(nonce);
    expect(textOf('mochi-server-island')?.nonce).toBe(nonce);

    const dataBlocks = tags.filter((t) => t.type === 'application/json');
    expect(dataBlocks.length).toBeGreaterThan(0);
    expect(dataBlocks.every((t) => t.nonce === null)).toBe(true);
  });

  test('getCspNonce() inside a component returns the request nonce', async () => {
    const res = await fetch(`${base}/page`);
    expect(await res.text()).toContain(`data-csp-nonce="${headerNonce(res)}"`);
  });

  test('the nonce differs per request and no response carries an earlier one', async () => {
    const first = await expectAllGatedScriptsNonced(await fetch(`${base}/page`));
    const second = await expectAllGatedScriptsNonced(await fetch(`${base}/page`));
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.html).not.toContain(first.nonce);
  });

  test('the fall-through 404 carries the nonce its middleware saw', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    await expectAllGatedScriptsNonced(res);
  });

  test('the error page for a failed render carries the request nonce', async () => {
    const res = await fetch(`${base}/throws`);
    expect(res.status).toBe(500);
    await expectAllGatedScriptsNonced(res);
  });

  test('a deferred server-island fragment ships no executable script', async () => {
    const html = await (await fetch(`${base}/page`)).text();
    const wrapper = html.match(/<mochi-server-island\b[^>]*>/)![0];
    const name = wrapper.match(/component-name="([^"]+)"/)![1]!;
    const props = wrapper.match(/signed-props="([^"]+)"/)![1]!;
    const res = await fetch(`${base}/_mochi/island/${name}?props=${encodeURIComponent(props)}`);
    expect(res.status).toBe(200);
    expect(headerNonce(res)).toBeTruthy();
    const fragment = await res.text();
    expect(fragment).toContain('deferred');
    expect((await scriptTags(fragment)).filter(isGated)).toEqual([]);
  });

  test('the cacheable client bundles never contain a nonce', async () => {
    const res = await fetch(`${base}/page`);
    const nonce = headerNonce(res)!;
    const srcs = (await scriptTags(await res.text())).flatMap((t) => (t.src ? [t.src] : []));
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      const asset = await fetch(`${base}${src}`);
      expect(asset.headers.get('cache-control')).toContain('immutable');
      expect(await asset.text()).not.toContain(nonce);
    }
  });
});
