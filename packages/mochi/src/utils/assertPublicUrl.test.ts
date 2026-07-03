import { describe, expect, test } from 'bun:test';
import { assertPublicUrl, SsrfGuardError } from './assertPublicUrl';
import type { UrlGuardOptions } from './assertPublicUrl';

const block: UrlGuardOptions = { allowedHosts: undefined, blockPrivateNetworks: true };

async function expectBlocked(src: string, opts: UrlGuardOptions = block) {
  await expect(assertPublicUrl(src, opts)).rejects.toBeInstanceOf(SsrfGuardError);
}

describe('assertPublicUrl', () => {
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

  test('rejects IPv4-embedded IPv6 forms (hex-mapped, NAT64, compatible, 6to4)', async () => {
    await expectBlocked('http://[::ffff:7f00:1]/a.png'); // hex IPv4-mapped 127.0.0.1
    await expectBlocked('http://[::ffff:a9fe:a9fe]/a.png'); // hex IPv4-mapped 169.254.169.254 (cloud metadata)
    await expectBlocked('http://[64:ff9b::7f00:1]/a.png'); // NAT64 127.0.0.1
    await expectBlocked('http://[::7f00:1]/a.png'); // IPv4-compatible 127.0.0.1
    await expectBlocked('http://[2002:c0a8:101::]/a.png'); // 6to4 embedding 192.168.1.1
  });

  test('still allows a genuinely public IPv6 (no false positive)', async () => {
    const url = await assertPublicUrl('https://[2606:4700:4700::1111]/a.png', block);
    expect(url.hostname).toBe('[2606:4700:4700::1111]');
  });

  test('rejects non-http protocols', async () => {
    await expectBlocked('file:///etc/passwd');
    await expectBlocked('data:image/png;base64,AAAA');
  });

  test('allows a public IP literal', async () => {
    const url = await assertPublicUrl('https://8.8.8.8/a.png', block);
    expect(url.hostname).toBe('8.8.8.8');
  });

  test('allows a public IPv6 literal (brackets stripped for the IP check, no DNS)', async () => {
    const url = await assertPublicUrl('https://[2606:4700::6810:84e5]/a.png', block);
    expect(url.hostname).toBe('[2606:4700::6810:84e5]');
  });

  test('enforces an allowlist (exact + wildcard) without DNS', async () => {
    const opts = { allowedHosts: ['cdn.example.com', '*.images.net'], blockPrivateNetworks: false };
    expect((await assertPublicUrl('https://cdn.example.com/a.png', opts)).hostname).toBe('cdn.example.com');
    expect((await assertPublicUrl('https://foo.images.net/a.png', opts)).hostname).toBe('foo.images.net');
    await expectBlocked('https://evil.com/a.png', opts);
    await expectBlocked('https://images.net/a.png', opts); // bare apex doesn't match *.images.net
  });
});
