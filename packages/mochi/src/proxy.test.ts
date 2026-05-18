import { describe, expect, test } from 'bun:test';
import { buildPublicUrl, getClientAddress, resolveExpectedOrigin } from './proxy';

const SAME = 'http://localhost:3333';
const sameUrl = new URL(`${SAME}/submit`);

function req(headers: Record<string, string> = {}): Request {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v);
  }
  return new Request(sameUrl, { method: 'POST', headers: h });
}

describe('resolveExpectedOrigin', () => {
  test('falls back to url.origin when no options set', () => {
    expect(resolveExpectedOrigin(req(), sameUrl, undefined)).toBe(SAME);
    expect(resolveExpectedOrigin(req(), sameUrl, {})).toBe(SAME);
  });

  test('explicit origin overrides url.origin', () => {
    expect(resolveExpectedOrigin(req(), sameUrl, { origin: 'https://my.site' })).toBe('https://my.site');
  });

  test('explicit origin wins over header config', () => {
    const r = req({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example' });
    expect(
      resolveExpectedOrigin(r, sameUrl, {
        origin: 'https://my.site',
        protocolHeader: 'x-forwarded-proto',
        hostHeader: 'x-forwarded-host',
      }),
    ).toBe('https://my.site');
  });

  test('protocolHeader + hostHeader build origin from forwarded headers', () => {
    const r = req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.site' });
    expect(
      resolveExpectedOrigin(r, sameUrl, {
        protocolHeader: 'x-forwarded-proto',
        hostHeader: 'x-forwarded-host',
      }),
    ).toBe('https://my.site');
  });

  test('portHeader appends port and replaces any port already on the host', () => {
    const r = req({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'my.site:1234',
      'x-forwarded-port': '8443',
    });
    expect(
      resolveExpectedOrigin(r, sameUrl, {
        protocolHeader: 'x-forwarded-proto',
        hostHeader: 'x-forwarded-host',
        portHeader: 'x-forwarded-port',
      }),
    ).toBe('https://my.site:8443');
  });

  test('missing header values fall back to url.protocol/host pieces', () => {
    expect(
      resolveExpectedOrigin(req(), sameUrl, {
        protocolHeader: 'x-forwarded-proto',
        hostHeader: 'x-forwarded-host',
      }),
    ).toBe(SAME);
  });

  test('hostHeader alone uses url.protocol', () => {
    const r = req({ 'x-forwarded-host': 'public.example' });
    expect(resolveExpectedOrigin(r, sameUrl, { hostHeader: 'x-forwarded-host' })).toBe('http://public.example');
  });
});

describe('buildPublicUrl', () => {
  test('returns the raw request URL when no proxy options are set', () => {
    const r = new Request('http://localhost:3333/foo?x=1');
    const out = buildPublicUrl(r, undefined);
    expect(out.origin).toBe('http://localhost:3333');
    expect(out.pathname).toBe('/foo');
    expect(out.search).toBe('?x=1');
  });

  test('rewrites origin to explicit proxy.origin', () => {
    const r = new Request('http://localhost:3333/foo?x=1');
    const out = buildPublicUrl(r, { origin: 'https://my.site' });
    expect(out.origin).toBe('https://my.site');
    expect(out.pathname).toBe('/foo');
    expect(out.search).toBe('?x=1');
  });

  test('rewrites origin from forwarded headers', () => {
    const r = new Request('http://localhost:3333/foo', {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.site' },
    });
    const out = buildPublicUrl(r, {
      protocolHeader: 'x-forwarded-proto',
      hostHeader: 'x-forwarded-host',
    });
    expect(out.origin).toBe('https://my.site');
    expect(out.pathname).toBe('/foo');
  });
});

describe('getClientAddress', () => {
  test('returns the connecting fallback when no options configured', () => {
    expect(getClientAddress(req(), '10.0.0.1', undefined)).toBe('10.0.0.1');
    expect(getClientAddress(req(), '10.0.0.1', {})).toBe('10.0.0.1');
  });

  test('returns null when no fallback and no options', () => {
    expect(getClientAddress(req(), null, undefined)).toBeNull();
  });

  test('reads a single-value header (e.g. true-client-ip) verbatim', () => {
    const r = req({ 'true-client-ip': '203.0.113.7' });
    expect(getClientAddress(r, '10.0.0.1', { addressHeader: 'true-client-ip' })).toBe('203.0.113.7');
  });

  test('falls back when the configured header is missing', () => {
    expect(getClientAddress(req(), '10.0.0.1', { addressHeader: 'true-client-ip' })).toBe('10.0.0.1');
  });

  test('addressHeader matching is case-insensitive for x-forwarded-for', () => {
    const r = req({ 'X-Forwarded-For': '203.0.113.7, 10.0.0.2' });
    expect(getClientAddress(r, '10.0.0.1', { addressHeader: 'X-Forwarded-For' })).toBe(
      '10.0.0.2', // depth defaults to 1 → rightmost
    );
  });

  test('xffDepth=1 returns the rightmost entry (innermost trusted proxy)', () => {
    const r = req({ 'x-forwarded-for': 'client, proxy1, proxy2' });
    expect(getClientAddress(r, null, { addressHeader: 'x-forwarded-for', xffDepth: 1 })).toBe('proxy2');
  });

  test('xffDepth=3 with three trusted proxies returns the client (leftmost)', () => {
    // chain: client → proxy1 → proxy2 → proxy3 → server
    // proxy3 sees: "client, proxy1, proxy2"
    const r = req({ 'x-forwarded-for': 'client, proxy1, proxy2' });
    expect(getClientAddress(r, null, { addressHeader: 'x-forwarded-for', xffDepth: 3 })).toBe('client');
  });

  test('xffDepth ignores spoofed entries to the left of the trusted chain', () => {
    // Client sets `spoofed`; proxy1 appends client; proxy2 appends proxy1; proxy3 appends proxy2.
    // With 3 trusted proxies, depth=3 picks the entry 3 from the right → "client", not "spoofed".
    const r = req({ 'x-forwarded-for': 'spoofed, client, proxy1, proxy2' });
    expect(getClientAddress(r, null, { addressHeader: 'x-forwarded-for', xffDepth: 3 })).toBe('client');
  });

  test('xffDepth deeper than the chain returns the leftmost entry', () => {
    const r = req({ 'x-forwarded-for': 'a, b' });
    expect(getClientAddress(r, 'fb', { addressHeader: 'x-forwarded-for', xffDepth: 5 })).toBe('a');
  });

  test('empty x-forwarded-for falls back to the connecting address', () => {
    const r = req({ 'x-forwarded-for': '   ,  ' });
    expect(getClientAddress(r, '10.0.0.1', { addressHeader: 'x-forwarded-for' })).toBe('10.0.0.1');
  });

  test('xffDepth is ignored when addressHeader is not x-forwarded-for', () => {
    const r = req({ 'true-client-ip': '203.0.113.7, 10.0.0.2' });
    expect(getClientAddress(r, null, { addressHeader: 'true-client-ip', xffDepth: 3 })).toBe('203.0.113.7, 10.0.0.2');
  });
});
