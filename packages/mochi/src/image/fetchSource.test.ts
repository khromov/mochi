import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchImageSource } from './fetchSource';
import { registerLocalImageAsset } from './localAssetRegistry';
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
    localDirs: {},
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
    // Not in the registry → falls through to assertPublicUrl, which rejects a
    // relative (non-http/https) src with a 400 SsrfGuard-mapped ImageError.
    await expect(fetchImageSource('/_mochi/asset/nope-0.png', opts())).rejects.toBeInstanceOf(ImageError);
  });
});

describe('fetchImageSource local-dir branch', () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)['__mochi_config__'];
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function writeDirFile(bytes: Buffer): { root: string; src: string } {
    // The resolver reads the asset prefix from the global config.
    (globalThis as unknown as Record<string, unknown>)['__mochi_config__'] = {
      options: {},
      secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
    };
    const root = mkdtempSync(join(tmpdir(), 'mochi-localdir-'));
    dirs.push(root);
    writeFileSync(join(root, 'photo.png'), bytes);
    return { root, src: '/_mochi/files/media/photo.png' };
  }

  test('reads a configured local-dir image from disk without fetching', async () => {
    const { root, src } = writeDirFile(PNG);
    const { bytes, contentType } = await fetchImageSource(src, opts({ localDirs: { media: root }, allowedHosts: undefined, blockPrivateNetworks: true }));
    expect(contentType).toBe('image/png');
    expect(Buffer.from(bytes)).toEqual(PNG);
  });

  test('a missing file under a configured dir is a 404 ImageError, not an SSRF rejection', async () => {
    const { root } = writeDirFile(PNG);
    await expect(fetchImageSource('/_mochi/files/media/nope.png', opts({ localDirs: { media: root } }))).rejects.toMatchObject({ status: 404 });
  });

  test('with no localDirs configured, a same-origin src never touches the resolver and is rejected as a URL', async () => {
    await expect(fetchImageSource('/_mochi/files/media/photo.png', opts())).rejects.toBeDefined();
  });
});
