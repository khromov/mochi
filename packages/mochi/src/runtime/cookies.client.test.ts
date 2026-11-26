import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/app/' });

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createClientCookies } from './cookies.client';
import { clientCookieDefaults, type CookieSerializeOptions } from './cookies';

// Captures the raw strings js-cookie hands to `document.cookie`, i.e. exactly the attributes the browser receives.
let writes: string[] = [];

beforeEach(() => {
  writes = [];
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => '',
    set: (raw: string) => {
      writes.push(raw);
    },
  });
});

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).cookie;
  delete window.__mochi_cookie_defaults;
});

function written(): { pair: string; attrs: Record<string, string | true> } {
  expect(writes).toHaveLength(1);
  const [pair = '', ...rest] = writes[0]!.split('; ');
  return { pair, attrs: Object.fromEntries(rest.map((a) => [a.split('=')[0]!, a.includes('=') ? a.slice(a.indexOf('=') + 1) : true])) };
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe('client cookie jar applies cookie:defaults', () => {
  test('set() carries the defaults the server shell seeded', () => {
    window.__mochi_cookie_defaults = clientCookieDefaults({ secure: true, sameSite: 'Strict', path: '/app/' });
    createClientCookies().set('pref', 'dark');
    expect(written()).toEqual({ pair: 'pref=dark', attrs: { path: '/app/', secure: true, sameSite: 'Strict' } });
  });

  test('per-call options override the defaults per field', () => {
    window.__mochi_cookie_defaults = { secure: true, sameSite: 'Strict', path: '/app/' };
    createClientCookies().set('pref', 'dark', { path: '/', sameSite: 'Lax' });
    expect(written()).toEqual({ pair: 'pref=dark', attrs: { path: '/', secure: true, sameSite: 'Lax' } });
  });

  test('delete() replays the default path so it expires the cookie the server set', () => {
    window.__mochi_cookie_defaults = { path: '/app/', domain: 'example.com' };
    createClientCookies().delete('session');
    const { pair, attrs } = written();
    expect(pair).toBe('session=');
    expect(attrs).toMatchObject({ path: '/app/', domain: 'example.com' });
    expect(new Date(attrs.expires as string).getTime()).toBeLessThan(Date.now());
  });

  test('without seeded defaults the jar keeps js-cookie’s Path=/', () => {
    createClientCookies().set('pref', 'dark');
    expect(written()).toEqual({ pair: 'pref=dark', attrs: { path: '/' } });
  });
});

describe('client cookie jar never writes HttpOnly', () => {
  const options: CookieSerializeOptions = { httpOnly: true, sameSite: 'Lax', path: '/app/' };

  test('set() drops a per-call httpOnly and keeps the rest', () => {
    createClientCookies().set('session', 'abc', options);
    expect(written()).toEqual({ pair: 'session=abc', attrs: { path: '/app/', sameSite: 'Lax' } });
  });

  test('delete() drops a per-call httpOnly and keeps the rest', () => {
    createClientCookies().delete('session', options);
    const { pair, attrs } = written();
    expect(pair).toBe('session=');
    expect(attrs).toMatchObject({ path: '/app/', sameSite: 'Lax' });
    expect(attrs).not.toHaveProperty('httpOnly');
  });
});

describe('clientCookieDefaults', () => {
  test('drops what document.cookie cannot honour', () => {
    expect(
      clientCookieDefaults({
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        domain: 'example.com',
        maxAge: 60,
        expires: 1,
        partitioned: true,
        priority: 'High',
      }),
    ).toEqual({ path: '/', domain: 'example.com', secure: true, sameSite: 'Lax', partitioned: true, priority: 'High' });
  });

  test('returns undefined when nothing applies, so the shell seeds nothing', () => {
    expect(clientCookieDefaults({})).toBeUndefined();
    expect(clientCookieDefaults({ httpOnly: true, maxAge: 60 })).toBeUndefined();
  });
});
