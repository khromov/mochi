import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { fetchImageSource } from './fetchSource';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';
import { initExtensions } from '../extensions';

// A 1x1 PNG — fetchImageSource doesn't decode, it just streams bytes through.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Test server: a relative redirect to an allowed path, a redirect to a host
// outside the allowlist, and an infinite redirector to exhaust the hop cap.
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/image') {
      return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
    }
    if (pathname === '/redirect-ok') {
      return new Response(null, { status: 302, headers: { Location: '/image' } });
    }
    if (pathname === '/redirect-bad') {
      return new Response(null, { status: 302, headers: { Location: 'http://10.0.0.1/x.png' } });
    }
    if (pathname === '/redirect-chain') {
      // Same-host (allowed) hop that itself redirects off-allowlist on the next hop.
      return new Response(null, { status: 302, headers: { Location: '/redirect-bad' } });
    }
    if (pathname.startsWith('/loop/')) {
      const n = Number(pathname.slice('/loop/'.length));
      return new Response(null, { status: 302, headers: { Location: `/loop/${n + 1}` } });
    }
    return new Response('not found', { status: 404 });
  },
});

const HOST = `127.0.0.1:${server.port}`;
const base = (path: string): string => `http://${HOST}${path}`;

// blockPrivateNetworks is off (the test server is on loopback); the allowlist is
// the active guard, so a cross-host redirect is what must be rejected per-hop.
function opts(over: Partial<ResolvedImageOptions> = {}): ResolvedImageOptions {
  return {
    enabled: true,
    sizes: {},
    cacheDir: '/tmp/unused',
    defaultFormat: 'webp',
    defaultQuality: 80,
    outputFormats: ['webp', 'jpeg', 'png', 'avif'],
    inputFormats: ['jpeg', 'png', 'webp', 'avif', 'gif'],
    maxPixels: 50_000_000,
    autoOrient: true,
    allowedHosts: ['127.0.0.1'],
    blockPrivateNetworks: false,
    fetchTimeoutMs: 5_000,
    maxResponseBytes: 20 * 1024 * 1024,
    timeToStale: 60_000,
    timeToEvict: 86_400_000,
    compressPayload: true,
    sweepIntervalMs: 0,
    ...over,
  };
}

afterEach(() => {
  // Reset the (process-global) extension registry between tests.
  initExtensions({ eventHooks: {}, filters: {} });
});

afterAll(() => {
  server.stop(true);
});

describe('fetchImageSource redirect re-validation', () => {
  test('follows a same-host redirect to an allowed path', async () => {
    const { bytes, contentType } = await fetchImageSource(base('/redirect-ok'), opts());
    expect(contentType).toBe('image/png');
    expect(bytes.byteLength).toBe(PNG.byteLength);
  });

  test('rejects a redirect whose target host is not on the allowlist', async () => {
    await expect(fetchImageSource(base('/redirect-bad'), opts())).rejects.toBeInstanceOf(ImageError);
  });

  test('rejects a chain longer than the default hop cap', async () => {
    await expect(fetchImageSource(base('/loop/0'), opts())).rejects.toMatchObject({
      status: 502,
      message: 'Too many redirects',
    });
  });

  test('blockPrivateNetworks rejects a redirect that targets a private address', async () => {
    // The headline SSRF threat: a public host 302s us into a private network.
    // A loopback test server can't be the initial hop here (blockPrivateNetworks
    // would reject 127.0.0.1 before any redirect), so fetch is stubbed to start
    // the chain at a public IP literal. The private redirect target must be
    // rejected by the guard BEFORE it is ever fetched.
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetched.push(u);
      return new Response(null, { status: 302, headers: { Location: 'http://10.0.0.1/x.png' } });
    }) as typeof fetch;
    try {
      await expect(fetchImageSource('http://93.184.216.34/start', opts({ blockPrivateNetworks: true, allowedHosts: undefined }))).rejects.toMatchObject({
        status: 400,
        message: 'Source host resolves to a private address',
      });
      // Only the public initial hop was contacted; the private target never was.
      expect(fetched).toEqual(['http://93.184.216.34/start']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('re-validates an intermediate hop, not just the first', async () => {
    // hop 0 (/redirect-chain) and hop 1 (/redirect-bad) are both on the allowed
    // host; hop 1's target is off-allowlist. A loop that only validated hop 0
    // would follow the chain and fail fetching the blocked host (502) instead
    // of rejecting it with the allowlist error.
    await expect(fetchImageSource(base('/redirect-chain'), opts())).rejects.toMatchObject({
      status: 400,
      message: 'Source host is not in the allowlist',
    });
  });

  test('the image:maxRedirects filter tightens the cap', async () => {
    initExtensions({ eventHooks: {}, filters: { 'image:maxRedirects': () => 0 } });
    // With a cap of 0, even a single allowed redirect is refused.
    await expect(fetchImageSource(base('/redirect-ok'), opts())).rejects.toMatchObject({
      message: 'Too many redirects',
    });
  });
});
