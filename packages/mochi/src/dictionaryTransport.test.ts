import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { loadDczCodec, setDictionaryState } from './runtime/dictionary';

const HOME = path.join(import.meta.dir, '__fixtures__', 'dictionary', 'Home.svelte');
const OTHER = path.join(import.meta.dir, '__fixtures__', 'dictionary', 'Other.svelte');

describe('compression dictionary transport (production)', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let dictBytes: Uint8Array;
  let dictHashB64: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-dict-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      dictionary: { routes: ['/'], id: 'test-dict' },
      routes: {
        '/': Mochi.page(HOME),
        '/other': Mochi.page(OTHER),
      },
    });
    base = `http://localhost:${server.port}`;

    // The dictionary bootstrap is fire-and-forget after boot; poll the route until it lands.
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${base}/_mochi/dictionary`);
      if (res.status === 200) {
        dictBytes = new Uint8Array(await res.arrayBuffer());
        break;
      }
      await Bun.sleep(50);
    }
    if (!dictBytes) {
      throw new Error('dictionary route never became ready');
    }
    dictHashB64 = createHash('sha256').update(dictBytes).digest('base64');
  });

  afterAll(() => {
    server.stop(true);
    setDictionaryState(null);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('dictionary route carries Use-As-Dictionary and refreshable caching', async () => {
    const res = await fetch(`${base}/_mochi/dictionary`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('use-as-dictionary')).toBe('match="/*", match-dest=("document"), id="test-dict"');
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  test('dictionary bytes are the rendered home page HTML', () => {
    const text = new TextDecoder().decode(dictBytes);
    expect(text).toContain('Home page');
    expect(text).toContain('shared navigation markup');
  });

  test('pages advertise the dictionary via Link and Vary', async () => {
    const res = await fetch(`${base}/other`);
    expect(res.status).toBe(200);
    expect(res.headers.get('link')).toBe('</_mochi/dictionary>; rel="compression-dictionary"');
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Available-Dictionary');
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  test('a request with the matching Available-Dictionary gets a dcz delta', async () => {
    const plain = await (await fetch(`${base}/other`)).text();

    const res = await fetch(`${base}/other`, {
      headers: { 'Accept-Encoding': 'gzip, br, zstd, dcb, dcz', 'Available-Dictionary': `:${dictHashB64}:`, 'Dictionary-ID': '"test-dict"' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('dcz');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body.slice(0, 8))).toEqual([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0x00, 0x00, 0x00]);
    expect(Buffer.from(body.slice(8, 40)).toString('base64')).toBe(dictHashB64);
    expect(body.length).toBeLessThan(plain.length);

    // Reuse the in-process server's single init: the lib's init() is not idempotent and corrupts in-flight contexts when re-run.
    await loadDczCodec();
    const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
    const restored = new TextDecoder().decode(decompressUsingDict(createDCtx(), body.slice(40), dictBytes));
    expect(restored).toBe(plain);
  });

  test('a stale dictionary hash falls back to identity', async () => {
    const res = await fetch(`${base}/other`, {
      headers: { 'Accept-Encoding': 'dcz', 'Available-Dictionary': `:${Buffer.alloc(32, 9).toString('base64')}:` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toContain('Other page');
  });
});
