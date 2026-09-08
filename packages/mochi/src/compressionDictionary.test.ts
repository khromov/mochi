import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { compress } from './middleware/compress';
import { mochiEvents } from './events';
import type { MochiDictionaryReadyEvent } from './events';
import { success } from './runtime/forms';
import { DCZ_MAGIC, loadDczCodec } from './runtime/compressionDictionary';

const PAGE = path.join(import.meta.dir, '__fixtures__', 'dictionary', 'Page.svelte');
const CHROME_ACCEPT = 'gzip, deflate, br, zstd, dcz';

describe('compressionDictionary end-to-end', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let ready: MochiDictionaryReadyEvent;
  let dictionaryBytes: Uint8Array;
  let availableDictionary: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-dcz-'));
    const readyPromise = new Promise<MochiDictionaryReadyEvent>((resolve) => {
      const handler = (event: MochiDictionaryReadyEvent): void => {
        mochiEvents.off('dictionary:ready', handler);
        resolve(event);
      };
      mochiEvents.on('dictionary:ready', handler);
    });

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      csrf: { checkOrigin: false },
      compressionDictionary: { enabledInProd: true, enabledInDev: false, zstdLevel: 12 },
      handle: compress(),
      routes: {
        '/': Mochi.page(PAGE, { serverProps: { title: 'home' } }),
        '/about': Mochi.page(PAGE, { serverProps: { title: 'about' } }),
        '/account': Mochi.page(PAGE, { serverProps: { title: 'account' }, actions: { default: () => success({}) } }),
      },
    });
    base = `http://localhost:${server.port}`;
    ready = await readyPromise;

    const res = await fetch(`${base}/_mochi/dictionary/${ready.hash}`);
    expect(res.status).toBe(200);
    dictionaryBytes = new Uint8Array(await res.arrayBuffer());
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(dictionaryBytes);
    availableDictionary = `:${Buffer.from(hasher.digest()).toString('base64')}:`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  async function decode(framed: Uint8Array): Promise<string> {
    await loadDczCodec();
    const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
    return new TextDecoder().decode(decompressUsingDict(createDCtx(), framed.slice(40), dictionaryBytes));
  }

  test('harvests every static route and reports the dictionary', () => {
    expect(ready.routeCount).toBe(3);
    expect(ready.sizeBytes).toBeGreaterThan(0);
    expect(ready.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('pages advertise the dictionary via a Link header', async () => {
    const res = await fetch(`${base}/`, { headers: { 'Accept-Encoding': 'identity' } });
    expect(res.headers.get('link')).toBe(`</_mochi/dictionary/${ready.hash}>; rel="compression-dictionary"`);
    // The harvested HTML must stay byte-identical to what is served, so the advertisement lives in a header.
    expect(await res.text()).not.toContain('compression-dictionary');
  });

  test('dictionary endpoint carries Use-As-Dictionary and immutable caching', async () => {
    const res = await fetch(`${base}/_mochi/dictionary/${ready.hash}`);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('use-as-dictionary')).toBe('match="/*", match-dest=("document" "frame" "iframe")');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const hashOfBody = new Bun.CryptoHasher('sha256');
    hashOfBody.update(new Uint8Array(await res.arrayBuffer()));
    expect(Buffer.from(hashOfBody.digest()).toString('hex')).toBe(ready.hash);
  });

  test('unknown dictionary hash 404s', async () => {
    const res = await fetch(`${base}/_mochi/dictionary/${'0'.repeat(64)}`);
    expect(res.status).toBe(404);
  });

  test('a matching Available-Dictionary gets a dcz response that round-trips', async () => {
    const plainHtml = await (await fetch(`${base}/about`, { headers: { 'Accept-Encoding': 'identity' } })).text();

    const res = await fetch(`${base}/about`, {
      headers: { 'Accept-Encoding': CHROME_ACCEPT, 'Available-Dictionary': availableDictionary },
    });
    expect(res.headers.get('content-encoding')).toBe('dcz');
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Available-Dictionary');

    const framed = new Uint8Array(await res.arrayBuffer());
    expect(framed.slice(0, 8)).toEqual(DCZ_MAGIC);
    expect(Buffer.from(framed.slice(8, 40)).toString('hex')).toBe(ready.hash);
    expect(await decode(framed)).toBe(plainHtml);
    expect(framed.length).toBeLessThan(plainHtml.length);
  });

  test('a form action POST re-render is never dcz-encoded, even holding the dictionary', async () => {
    const res = await fetch(`${base}/account`, {
      method: 'POST',
      headers: { 'Accept-Encoding': CHROME_ACCEPT, 'Available-Dictionary': availableDictionary, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).not.toBe('dcz');
    expect(await res.text()).toContain('account');
  });

  test('a stale dictionary hash falls back to standard negotiation with Vary intact', async () => {
    const res = await fetch(`${base}/`, {
      headers: { 'Accept-Encoding': CHROME_ACCEPT, 'Available-Dictionary': `:${Buffer.alloc(32, 1).toString('base64')}:` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).not.toBe('dcz');
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Available-Dictionary');
  });

  test('clients without Available-Dictionary negotiate normally and still see Vary', async () => {
    const res = await fetch(`${base}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Available-Dictionary');
  });
});
