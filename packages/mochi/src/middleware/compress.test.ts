import { describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import type { MochiEvent } from '../runtime/hooks';
import type { CompressionMethod } from '../utils';
import { compress } from './compress';

// compress() reads dev mode from the Mochi.serve() config singleton; fake it via its global key.
async function withMochiConfig<T>(development: boolean, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as Record<string, unknown>;
  g['__mochi_config__'] = { options: { development }, secretKey: Buffer.alloc(32) };
  try {
    return await fn();
  } finally {
    delete g['__mochi_config__'];
  }
}

function makeEvent(req: Request): MochiEvent {
  return {
    request: req,
    url: new URL(req.url),
    server: {} as Server<undefined>,
    locals: {},
    kind: 'page',
    isWarmup: false,
  };
}

describe('compress()', () => {
  test('compresses HTML when Accept-Encoding includes gzip', async () => {
    const handle = compress();
    const body = '<!doctype html><html><body>' + 'hello '.repeat(500) + '</body></html>';
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip, deflate' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');

    const compressed = new Uint8Array(await response.arrayBuffer());
    expect(compressed.byteLength).toBeLessThan(body.length);
    const restored = new TextDecoder().decode(Bun.gunzipSync(compressed));
    expect(restored).toBe(body);
  });

  test('skips compression but adds Vary when Accept-Encoding is missing', async () => {
    const handle = compress();
    const body = '<p>hello</p>';
    const req = new Request('http://localhost/');

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    expect(await response.text()).toBe(body);
  });

  test('skips compression for non-compressible content types', async () => {
    const handle = compress();
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
  });

  test('passes through responses that already declare Content-Encoding', async () => {
    const handle = compress();
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const upstream = new Response('already-compressed', {
      headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'br' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => upstream,
    });

    expect(response).toBe(upstream);
    expect(response.headers.get('Content-Encoding')).toBe('br');
  });

  test('removes Content-Length when compressing', async () => {
    const handle = compress();
    const body = 'x'.repeat(2048);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () =>
        new Response(body, {
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': String(body.length),
          },
        }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(response.headers.get('Content-Length')).toBeNull();
    const restored = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await response.arrayBuffer())));
    expect(restored).toBe(body);
  });

  test('compresses JSON responses', async () => {
    const handle = compress();
    const body = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })) });
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    const restored = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await response.arrayBuffer())));
    expect(restored).toBe(body);
  });

  // Brotli is intentionally unsupported (Bun's CompressionStream('brotli') is fixed at q11) — a br-only client is left
  // uncompressed rather than served a slow buffered stream.
  test('does not compress when Accept-Encoding only offers the unsupported br', async () => {
    const handle = compress();
    const body = '<!doctype html><html><body>' + 'hello '.repeat(500) + '</body></html>';
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'br' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    expect(await response.text()).toBe(body);
  });

  test('client preference wins: Accept-Encoding "gzip, br" picks gzip', async () => {
    const handle = compress();
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip, br' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
  });

  test('Accept-Encoding "br, gzip" falls back to gzip since brotli is unsupported', async () => {
    const handle = compress();
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'br, gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
  });

  test('client q-values win over header order: br;q=0.5, gzip picks gzip', async () => {
    const handle = compress();
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'br;q=0.5, gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
  });

  test('honors q=0 to skip an otherwise-preferred encoding', async () => {
    const handle = compress({ methods: ['zstd', 'gzip'] });
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'zstd;q=0, gzip' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
  });

  test('Accept-Encoding: * picks the first configured method', async () => {
    const handle = compress({ methods: ['zstd', 'gzip'] });
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': '*' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('zstd');
  });

  test('Accept-Encoding: * picks the first configured method (gzip-first order)', async () => {
    const handle = compress({ methods: ['gzip', 'zstd'] });
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': '*' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
  });

  test('skips compression when methods exclude what the client offers', async () => {
    const handle = compress({ methods: ['gzip'] });
    const body = '<p>hello</p>';
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'br' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
  });

  test('empty methods array still adds Vary but never compresses', async () => {
    const handle = compress({ methods: [] });
    const body = '<p>hello</p>';
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip, br' },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Accept-Encoding');
    expect(await response.text()).toBe(body);
  });

  // 'brotli' was a valid method before it was dropped; an upgraded app must degrade to its other methods rather than
  // dereference a missing token and 500 every request.
  test('ignores a method this build no longer supports', async () => {
    const handle = compress({ methods: ['brotli' as CompressionMethod, 'gzip'] });
    const body = 'x'.repeat(1024);
    const req = new Request('http://localhost/', { headers: { 'Accept-Encoding': 'gzip, br' } });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    const restored = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await response.arrayBuffer())));
    expect(restored).toBe(body);
  });

  test('an unsupported method as the only method leaves the response uncompressed', async () => {
    const handle = compress({ methods: ['brotli' as CompressionMethod] });
    const body = '<p>hello</p>';
    const req = new Request('http://localhost/', { headers: { 'Accept-Encoding': 'br, gzip' } });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toBe(body);
  });

  test('compresses with zstd when the client asks for it', async () => {
    const handle = compress({ methods: ['zstd', 'gzip'] });
    const body = '<!doctype html>' + 'hello '.repeat(500);
    const req = new Request('http://localhost/', { headers: { 'Accept-Encoding': 'zstd' } });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('zstd');
    const restored = await new Response(response.body!.pipeThrough(new DecompressionStream('zstd' as CompressionFormat))).text();
    expect(restored).toBe(body);
  });

  test('compresses with deflate when the client asks for it', async () => {
    const handle = compress({ methods: ['deflate'] });
    const body = 'x'.repeat(2048);
    const req = new Request('http://localhost/', { headers: { 'Accept-Encoding': 'deflate' } });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/plain' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('deflate');
    const restored = await new Response(response.body!.pipeThrough(new DecompressionStream('deflate'))).text();
    expect(restored).toBe(body);
  });

  // The regression this middleware existed with for its whole life: it used to buffer the whole body before
  // compressing, so a streamed SSR response only reached the client once the handler had finished producing it.
  test('streams: a chunk reaches the client before the source stream closes', async () => {
    const handle = compress({ methods: ['gzip'] });
    const req = new Request('http://localhost/', { headers: { 'Accept-Encoding': 'gzip' } });
    let releaseTail!: () => void;
    const tailSent = new Promise<void>((r) => (releaseTail = r));

    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('head'.repeat(4096)));
        await tailSent;
        controller.enqueue(new TextEncoder().encode('tail'));
        controller.close();
      },
    });

    const response = await handle({
      event: makeEvent(req),
      resolve: async () => new Response(source, { headers: { 'Content-Type': 'text/html' } }),
    });

    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    const reader = response.body!.getReader();
    // Resolves only if the transform emitted without waiting for the source to close.
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value!.byteLength).toBeGreaterThan(0);

    releaseTail();
    const rest: Uint8Array[] = [first.value!];
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      rest.push(next.value);
    }
    const restored = new TextDecoder().decode(Bun.gunzipSync(Buffer.concat(rest)));
    expect(restored).toBe('head'.repeat(4096) + 'tail');
  });

  test('skips compression entirely in dev mode', async () => {
    await withMochiConfig(true, async () => {
      const handle = compress();
      const body = '<!doctype html>' + 'hello '.repeat(500);
      const req = new Request('http://localhost/', {
        headers: { 'Accept-Encoding': 'gzip, br' },
      });
      const upstream = new Response(body, { headers: { 'Content-Type': 'text/html' } });

      const response = await handle({
        event: makeEvent(req),
        resolve: async () => upstream,
      });

      expect(response).toBe(upstream);
      expect(response.headers.get('Content-Encoding')).toBeNull();
      expect(await response.text()).toBe(body);
    });
  });

  test('compresses when config is initialized with development: false', async () => {
    await withMochiConfig(false, async () => {
      const handle = compress();
      const body = '<!doctype html>' + 'hello '.repeat(500);
      const req = new Request('http://localhost/', {
        headers: { 'Accept-Encoding': 'gzip' },
      });

      const response = await handle({
        event: makeEvent(req),
        resolve: async () => new Response(body, { headers: { 'Content-Type': 'text/html' } }),
      });

      expect(response.headers.get('Content-Encoding')).toBe('gzip');
      const restored = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await response.arrayBuffer())));
      expect(restored).toBe(body);
    });
  });
});
