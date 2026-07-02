import { describe, expect, test } from 'bun:test';
import { assertAllowedSource } from './ssrfGuard';
import type { SsrfGuardOptions } from './ssrfGuard';
import { ImageError } from './types';

const block: SsrfGuardOptions = { allowedHosts: undefined, blockPrivateNetworks: true };

async function expectBlocked(src: string, opts: SsrfGuardOptions = block) {
  await expect(assertAllowedSource(src, opts)).rejects.toBeInstanceOf(ImageError);
}

describe('assertAllowedSource', () => {
  test('rejects localhost and loopback', async () => {
    await expectBlocked('http://localhost/a.png');
    await expectBlocked('http://127.0.0.1/a.png');
    await expectBlocked('http://[::1]/a.png');
  });

  test('rejects private IPv4 ranges', async () => {
    await expectBlocked('http://10.0.0.5/a.png');
    await expectBlocked('http://192.168.1.1/a.png');
    await expectBlocked('http://172.16.0.1/a.png');
    await expectBlocked('http://169.254.0.1/a.png');
  });

  test('rejects link-local / unique-local IPv6', async () => {
    await expectBlocked('http://[fe80::1]/a.png');
    await expectBlocked('http://[fd00::1]/a.png');
  });

  test('rejects non-http protocols', async () => {
    await expectBlocked('file:///etc/passwd');
    await expectBlocked('data:image/png;base64,AAAA');
  });

  test('allows a public IP literal', async () => {
    const url = await assertAllowedSource('https://8.8.8.8/a.png', block);
    expect(url.hostname).toBe('8.8.8.8');
  });

  test('allows a public IPv6 literal (brackets stripped for the IP check, no DNS)', async () => {
    const url = await assertAllowedSource('https://[2606:4700::6810:84e5]/a.png', block);
    expect(url.hostname).toBe('[2606:4700::6810:84e5]');
  });

  test('enforces an allowlist (exact + wildcard) without DNS', async () => {
    const opts = { allowedHosts: ['cdn.example.com', '*.images.net'], blockPrivateNetworks: false };
    expect((await assertAllowedSource('https://cdn.example.com/a.png', opts)).hostname).toBe('cdn.example.com');
    expect((await assertAllowedSource('https://foo.images.net/a.png', opts)).hostname).toBe('foo.images.net');
    await expectBlocked('https://evil.com/a.png', opts);
    await expectBlocked('https://images.net/a.png', opts); // bare apex doesn't match *.images.net
  });
});
