import { describe, expect, test } from 'bun:test';
import { finalizeCookieHeaders, MochiCookieJar } from './cookies';

describe('MochiCookieJar.wasAccessed', () => {
  test('is false on a fresh jar', () => {
    const jar = new MochiCookieJar('foo=bar');
    expect(jar.wasAccessed()).toBe(false);
  });

  test('flips to true after get()', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.get('foo');
    expect(jar.wasAccessed()).toBe(true);
  });

  test('flips to true after has()', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.has('foo');
    expect(jar.wasAccessed()).toBe(true);
  });

  test('flips to true after getAll()', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.getAll();
    expect(jar.wasAccessed()).toBe(true);
  });

  test('flips to true after set()', () => {
    const jar = new MochiCookieJar(null);
    jar.set('foo', 'bar');
    expect(jar.wasAccessed()).toBe(true);
  });

  test('flips to true after delete()', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.delete('foo');
    expect(jar.wasAccessed()).toBe(true);
  });

  test('returns false even when constructed with a Cookie header but never accessed', () => {
    const jar = new MochiCookieJar('session=abc; theme=dark');
    expect(jar.wasAccessed()).toBe(false);
  });
});

describe('finalizeCookieHeaders', () => {
  test('returns the same response when nothing was accessed', () => {
    const jar = new MochiCookieJar('foo=bar');
    const response = new Response('body');
    const out = finalizeCookieHeaders(response, jar);
    expect(out).toBe(response);
    expect(out.headers.get('Vary')).toBeNull();
    expect(out.headers.get('Set-Cookie')).toBeNull();
  });

  test('adds Vary: Cookie when only a read happened', () => {
    const jar = new MochiCookieJar('session=abc');
    jar.get('session');
    const out = finalizeCookieHeaders(new Response('body'), jar);
    expect(out.headers.get('Vary')).toBe('Cookie');
    expect(out.headers.get('Set-Cookie')).toBeNull();
  });

  test('adds both Set-Cookie and Vary: Cookie when a write happened', () => {
    const jar = new MochiCookieJar(null);
    jar.set('session', 'abc', { path: '/' });
    const out = finalizeCookieHeaders(new Response('body'), jar);
    expect(out.headers.get('Vary')).toBe('Cookie');
    expect(out.headers.get('Set-Cookie')).toContain('session=abc');
  });

  test('preserves an existing Vary value and appends Cookie', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.get('foo');
    const response = new Response('body', { headers: { Vary: 'Accept-Encoding' } });
    const out = finalizeCookieHeaders(response, jar);
    expect(out.headers.get('Vary')).toBe('Accept-Encoding, Cookie');
  });

  test('does not duplicate Cookie when already present in Vary', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.get('foo');
    const response = new Response('body', { headers: { Vary: 'Cookie' } });
    const out = finalizeCookieHeaders(response, jar);
    expect(out.headers.get('Vary')).toBe('Cookie');
  });

  test('respects Vary: * by leaving it untouched', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.get('foo');
    const response = new Response('body', { headers: { Vary: '*' } });
    const out = finalizeCookieHeaders(response, jar);
    expect(out.headers.get('Vary')).toBe('*');
  });
});

describe('MochiCookieJar defaults', () => {
  test('applies default options when set() omits them', () => {
    const jar = new MochiCookieJar(null, { secure: true, sameSite: 'Lax', path: '/' });
    jar.set('session', 'abc');
    const headers = jar.getSetCookieHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('Secure');
    expect(headers[0]).toContain('SameSite=Lax');
    expect(headers[0]).toContain('Path=/');
  });

  test('per-call options override defaults', () => {
    const jar = new MochiCookieJar(null, { secure: true, sameSite: 'Lax' });
    jar.set('session', 'abc', { secure: false, sameSite: 'Strict' });
    const headers = jar.getSetCookieHeaders();
    expect(headers[0]).not.toContain('Secure');
    expect(headers[0]).toContain('SameSite=Strict');
  });

  test('delete() inherits path/domain from defaults so the browser matches', () => {
    const jar = new MochiCookieJar('session=abc', { path: '/app', domain: 'example.com' });
    jar.delete('session');
    const headers = jar.getSetCookieHeaders();
    expect(headers[0]).toContain('Path=/app');
    expect(headers[0]).toContain('Domain=example.com');
    expect(headers[0]).toContain('Max-Age=0');
  });
});

describe('MochiCookieJar.varyOn', () => {
  test('finalizeCookieHeaders emits the recorded headers without adding Vary: Cookie', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.varyOn('User-Agent');
    jar.varyOn('accept-language');
    expect(jar.wasAccessed()).toBe(false);
    const final = finalizeCookieHeaders(new Response('ok'), jar);
    const vary = final.headers.get('Vary') ?? '';
    expect(vary).toContain('user-agent');
    expect(vary).toContain('accept-language');
    expect(vary).not.toContain('Cookie');
  });

  test('dedups against itself and a pre-existing Vary', () => {
    const jar = new MochiCookieJar(null);
    jar.varyOn('user-agent');
    jar.varyOn('User-Agent');
    const response = new Response('ok', { headers: { Vary: 'User-Agent' } });
    const final = finalizeCookieHeaders(response, jar);
    expect(final.headers.get('Vary')).toBe('User-Agent');
  });

  test('combines with Vary: Cookie when the jar was also read', () => {
    const jar = new MochiCookieJar('foo=bar');
    jar.get('foo');
    jar.varyOn('user-agent');
    const vary = finalizeCookieHeaders(new Response('ok'), jar).headers.get('Vary') ?? '';
    expect(vary).toContain('Cookie');
    expect(vary).toContain('user-agent');
  });
});
