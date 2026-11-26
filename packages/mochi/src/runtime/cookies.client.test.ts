import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/app/' });

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cookieWriteChecks, createClientCookies } from './cookies.client';
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

describe('client cookie jar honours a per-call maxAge', () => {
  test('set() writes maxAge as Max-Age, like the server jar', () => {
    createClientCookies().set('pref', 'dark', { maxAge: 3600 });
    expect(written()).toEqual({ pair: 'pref=dark', attrs: { path: '/', 'max-age': '3600' } });
  });

  test('set() keeps maxAge: 0, so the write expires the cookie', () => {
    createClientCookies().set('pref', 'dark', { maxAge: 0 });
    expect(written()).toEqual({ pair: 'pref=dark', attrs: { path: '/', 'max-age': '0' } });
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

type Stored = { name: string; value: string; path: string; httpOnly?: boolean };

// Enough of a browser cookie store to show what a read-back sees: path scoping, invisible HttpOnly cookies, and the
// writes a browser drops without an error (verified in Chrome).
function browserStore(initial: Stored[], { secureContext = true } = {}): { reads: number } {
  const store = [...initial];
  const stats = { reads: 0 };
  const here = window.location.pathname;
  const pathMatches = (path: string) => here === path || (here.startsWith(path) && (path.endsWith('/') || here[path.length] === '/'));
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => {
      stats.reads++;
      return store
        .filter((c) => !c.httpOnly && pathMatches(c.path))
        .sort((a, b) => b.path.length - a.path.length)
        .map((c) => (c.name ? `${c.name}=${c.value}` : c.value))
        .join('; ');
    },
    set: (raw: string) => {
      const [pair = '', ...rest] = raw.split('; ');
      const attrs = Object.fromEntries(rest.map((a) => [a.split('=')[0]!.toLowerCase(), a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
      const name = pair.slice(0, pair.indexOf('='));
      const path = typeof attrs.path === 'string' ? attrs.path : '/';
      if ((attrs.secure && !secureContext) || attrs.httponly || store.some((c) => c.name === name && c.path === path && c.httpOnly)) {
        return;
      }
      const index = store.findIndex((c) => c.name === name && c.path === path);
      const maxAge = typeof attrs['max-age'] === 'string' && /^-?\d+$/.test(attrs['max-age']) ? Number(attrs['max-age']) : undefined;
      const expired = maxAge !== undefined ? maxAge <= 0 : typeof attrs.expires === 'string' && new Date(attrs.expires).getTime() <= Date.now();
      const cookie = { name, value: pair.slice(pair.indexOf('=') + 1), path };
      if (index >= 0) {
        store.splice(index, 1, ...(expired ? [] : [cookie]));
      } else if (!expired) {
        store.push(cookie);
      }
    },
  });
  return stats;
}

describe('client cookie jar development warnings', () => {
  // The page is http://localhost/app/.
  const setup = (initial: Stored[] = [], opts?: { secureContext?: boolean }) => {
    const store = browserStore(initial, opts);
    const warn = mock((_message: string) => {});
    return { store, warn, jar: createClientCookies(cookieWriteChecks(warn)), messages: () => warn.mock.calls.map(([m]) => m) };
  };

  test('set() with httpOnly says the cookie was written without it, readable by scripts', () => {
    const { jar, messages } = setup();
    jar.set('session', 'abc', { httpOnly: true });
    expect(jar.get('session')).toBe('abc');
    expect(messages()).toEqual([expect.stringContaining('The cookie is written without it, so scripts on this page can read it')]);
  });

  test('delete() with httpOnly says an HttpOnly cookie survives it', () => {
    const { jar, messages } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    jar.delete('session', { httpOnly: true });
    expect(messages()).toEqual([expect.stringContaining('can neither see nor remove an HttpOnly cookie')]);
  });

  test('set() warns when a server-set HttpOnly cookie of the same name blocks the write', () => {
    const { jar, messages } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    jar.set('session', 'client');
    expect(messages()).toEqual([expect.stringContaining('cookies.set("session", …) had no effect: the browser refused the write.')]);
  });

  test('set() with httpOnly that the browser refuses reports the refusal, not a readable cookie', () => {
    const { jar, messages } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    jar.set('session', 'client', { httpOnly: true });
    expect(messages()).toEqual([expect.stringContaining('had no effect')]);
  });

  test('set() warns when the browser refuses a secure default on a page that is not a secure context', () => {
    window.__mochi_cookie_defaults = { secure: true };
    const { jar, messages } = setup([], { secureContext: false });
    jar.set('pref', 'dark');
    expect(messages()).toEqual([expect.stringContaining('had no effect')]);
  });

  test('delete() warns when the cookie is still readable afterwards', () => {
    const { jar, messages } = setup([{ name: 'cart', value: '3', path: '/' }]);
    jar.delete('cart', { path: '/app/' });
    expect(jar.get('cart')).toBe('3');
    expect(messages()).toEqual([expect.stringContaining('cookies.delete("cart") had no effect: a cookie named "cart" is still readable on this page.')]);
  });

  test('delete() warns when the browser refuses its secure default', () => {
    window.__mochi_cookie_defaults = { secure: true };
    const { jar, messages } = setup([{ name: 'cart', value: '3', path: '/' }], { secureContext: false });
    jar.delete('cart');
    expect(messages()).toEqual([expect.stringContaining('had no effect')]);
  });

  test('set() warns when a positive maxAge overrides a past expires and the browser refuses the write', () => {
    const { jar, messages } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    jar.set('session', 'client', { maxAge: 3600, expires: -1 });
    expect(messages()).toEqual([expect.stringContaining('had no effect')]);
  });

  test('set() warns when a non-integer or non-finite negative maxAge is ignored and the browser refuses the write', () => {
    for (const maxAge of [-0.5, Number.NEGATIVE_INFINITY, -1e21]) {
      const { jar, messages } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
      jar.set('session', 'client', { maxAge });
      expect(messages()).toEqual([expect.stringContaining('had no effect')]);
    }
  });

  test('set() ignores maxAge on cookie defaults during read-back because defaults do not write Max-Age', () => {
    window.__mochi_cookie_defaults = { maxAge: 0 };
    const refused = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    refused.jar.set('session', 'client');
    expect(refused.messages()).toEqual([expect.stringContaining('had no effect')]);

    window.__mochi_cookie_defaults = { maxAge: 3600 };
    const expired = setup([{ name: 'cart', value: '3', path: '/' }]);
    expired.jar.set('cart', '', { expires: -1 });
    expect(expired.jar.has('cart')).toBe(false);
    expect(expired.warn).not.toHaveBeenCalled();
  });

  test('each message prints once, however often the call repeats', () => {
    const { jar, warn } = setup([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
    for (const value of ['a', 'b', 'c']) {
      jar.set('pref', value, { httpOnly: true });
      jar.set('session', value);
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  describe('stays quiet', () => {
    test('for writes and deletes that land', () => {
      const { jar, warn } = setup([{ name: 'cart', value: '3', path: '/' }]);
      jar.set('pref', 'a b;c=d"é');
      jar.set('empty', '');
      jar.set('', 'nameless');
      jar.delete('cart');
      jar.delete('never-set');
      expect(jar.get('pref')).toBe('a b;c=d"é');
      expect(jar.has('cart')).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    test('for a cookie scoped by cookie:defaults to a path this page is not under', () => {
      window.__mochi_cookie_defaults = { path: '/admin/' };
      const { jar, warn } = setup([{ name: 'pref', value: 'light', path: '/' }]);
      jar.set('pref', 'dark');
      jar.delete('pref');
      expect(warn).not.toHaveBeenCalled();
    });

    test('for a per-call path this page is not under, including a mere string prefix of it', () => {
      const { jar, warn } = setup([{ name: 'pref', value: 'light', path: '/' }]);
      jar.set('pref', 'dark', { path: '/somewhere-else/' });
      jar.set('pref', 'dark', { path: '/ap' });
      jar.delete('pref', { path: '/ap' });
      expect(warn).not.toHaveBeenCalled();
    });

    test('for a write that lands behind a same-name cookie on a longer path', () => {
      const { jar, warn } = setup([{ name: 'theme', value: 'old', path: '/app/' }]);
      jar.set('theme', 'new', { path: '/' });
      expect(warn).not.toHaveBeenCalled();
    });

    test('for a delete that removes one of two same-name cookies', () => {
      const { jar, warn } = setup([
        { name: 'theme', value: 'root', path: '/' },
        { name: 'theme', value: 'app', path: '/app/' },
      ]);
      jar.delete('theme', { path: '/app/' });
      expect(jar.get('theme')).toBe('root');
      expect(warn).not.toHaveBeenCalled();
    });

    test('for a set() that expires the cookie', () => {
      const { jar, warn } = setup([
        { name: 'cart', value: '3', path: '/' },
        { name: 'pref', value: 'dark', path: '/' },
      ]);
      jar.set('cart', '', { expires: -1 });
      jar.set('gone', '', { expires: new Date(0) });
      jar.set('brief', '1', { expires: new Date(Math.floor(Date.now() / 1000) * 1000 + 999) });
      jar.set('pref', '1', { maxAge: 0 });
      jar.set('old', '1', { maxAge: -1 });
      jar.set('override', '1', { maxAge: 0, expires: 7 });
      jar.set('frac', '1', { maxAge: 0.5, expires: -1 });
      jar.set('nan', '1', { maxAge: Number.NaN, expires: -1 });
      jar.set('inf', '1', { maxAge: Number.POSITIVE_INFINITY, expires: -1 });
      jar.set('sci', '1', { maxAge: 1e21, expires: -1 });
      expect(jar.has('pref')).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    test('in production, where the jar gets no checks and skips the read-backs', () => {
      const store = browserStore([{ name: 'session', value: 'srv', path: '/', httpOnly: true }]);
      const jar = createClientCookies();
      jar.set('session', 'client', { httpOnly: true });
      jar.delete('session', { httpOnly: true });
      expect(store.reads).toBe(0);
    });
  });
});
