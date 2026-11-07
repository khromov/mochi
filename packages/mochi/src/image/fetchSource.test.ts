import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinnedFetchRequest, fetchImageSource, fetchPinned } from './fetchSource';
import { registerLocalImageAsset } from './localAssetRegistry';
import { ImageError } from './types';
import type { ResolvedImageOptions } from './types';
import { initExtensions } from '../extensions';

// A 1x1 PNG — fetchImageSource doesn't decode, it just streams bytes through.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Test server: a relative redirect to an allowed path, a redirect to a host
// outside the allowlist, and an infinite redirector to exhaust the hop cap.
let receivedHost: string | null = null;
// Read through a call so the `receivedHost = null` reset in a test does not narrow the type to `null`.
const lastReceivedHost = () => receivedHost;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    receivedHost = req.headers.get('host');
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
  test('pins a validated address while preserving the HTTP host and TLS server name', () => {
    const signal = new AbortController().signal;
    const request = createPinnedFetchRequest(new URL('https://cdn.example.com:8443/image.png'), '93.184.216.34', signal);

    expect(request.url.href).toBe('https://93.184.216.34:8443/image.png');
    expect(new Headers(request.init.headers).get('host')).toBe('cdn.example.com:8443');
    expect(request.init.tls?.serverName).toBe('cdn.example.com');
  });

  test('formats a pinned IPv6 address without changing the original Host header', () => {
    const request = createPinnedFetchRequest(new URL('http://images.example/image.png'), '2606:4700:4700::1111', new AbortController().signal);

    expect(request.url.href).toBe('http://[2606:4700:4700::1111]/image.png');
    expect(new Headers(request.init.headers).get('host')).toBe('images.example');
  });

  test('connects to the pinned address while the origin receives the original Host header', async () => {
    receivedHost = null;
    const original = new URL(`http://images.example:${server.port}/image`);
    const request = createPinnedFetchRequest(original, '127.0.0.1', new AbortController().signal);
    const response = await fetch(request.url, request.init);

    expect(response.status).toBe(200);
    expect(lastReceivedHost()).toBe(`images.example:${server.port}`);
  });

  test('fails over to the next validated address when the first refuses the connection', async () => {
    // 100::1 is the discard prefix — it fails the connect outright, so the loopback candidate behind it must still serve.
    const response = await fetchPinned(new URL(`http://images.example:${server.port}/image`), ['100::1', '127.0.0.1'], AbortSignal.timeout(5000));

    expect(response?.status).toBe(200);
  });

  test('gives up once the shared timeout aborts rather than walking the remaining addresses', async () => {
    const response = await fetchPinned(new URL(`http://images.example:${server.port}/image`), ['100::1', '127.0.0.1'], AbortSignal.abort());

    expect(response).toBeUndefined();
  });

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

describe('fetchImageSource local-asset branch', () => {
  const dirs: string[] = [];
  const registered: string[] = [];
  const localRegistry = () => (globalThis as unknown as Record<string, Map<string, unknown>>)['__mochi_local_image_assets__'];

  afterEach(() => {
    // Drop only the keys this suite registered, so we don't clobber sibling state.
    for (const url of registered.splice(0)) {
      localRegistry()?.delete(url);
    }
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function writeAsset(bytes: Buffer, contentType: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-localasset-'));
    dirs.push(dir);
    const diskPath = join(dir, 'hero.png');
    writeFileSync(diskPath, bytes);
    const url = `/_mochi/asset/hero-${dirs.length}.png`;
    registerLocalImageAsset(url, { diskPath, contentType });
    registered.push(url);
    return url;
  }

  test('reads a registered local asset from disk without fetching', async () => {
    const url = writeAsset(PNG, 'image/png');
    // A guard that fetched would need the src to be a public URL; a relative
    // asset URL would otherwise reject. Reaching the bytes proves the disk path.
    const { bytes, contentType } = await fetchImageSource(url, opts({ allowedHosts: undefined, blockPrivateNetworks: true }));
    expect(contentType).toBe('image/png');
    expect(Buffer.from(bytes)).toEqual(PNG);
  });

  test('an unregistered relative src still hits the SSRF guard', async () => {
    // Not in the registry → falls through to resolvePublicUrl, which rejects a
    // relative (non-http/https) src with a 400 SsrfGuard-mapped ImageError.
    await expect(fetchImageSource('/_mochi/asset/nope-0.png', opts())).rejects.toBeInstanceOf(ImageError);
  });
});
