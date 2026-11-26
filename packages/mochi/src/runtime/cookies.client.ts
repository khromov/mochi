import Cookies from '../vendor/js-cookie/index.ts';
import type { CookieSerializeOptions, Cookie } from './cookies';
import type {} from '../debug-bar/types';

type DeleteOptions = Omit<CookieSerializeOptions, 'maxAge' | 'expires'>;

// A cookie scoped to a path this page is not under is stored but never readable here, so a read-back must not count it as refused.
function readableHere(path: string | undefined): boolean {
  const here = window.location.pathname;
  return !path || here === path || (here.startsWith(path) && (path.endsWith('/') || here[path.length] === '/'));
}

// js-cookie writes Expires to the whole second, so a cookie due within the next second can be gone as soon as it lands.
function expiresNow(expires: number | Date | undefined, maxAge: number | undefined): boolean {
  // Max-Age wins over Expires, and a Max-Age of zero or less removes the cookie.
  if (maxAge !== undefined) {
    return maxAge <= 0;
  }
  const ms = typeof expires === 'number' ? expires * 864e5 : expires instanceof Date ? expires.getTime() - Date.now() : Infinity;
  return ms < 1000;
}

/** The `mochi-env` client module passes these to the jar in development builds only, so production bundles drop them. */
export function cookieWriteChecks(warn: (message: string) => void) {
  const warned = new Set<string>();
  // A reactive island can rerun a setter on every keystroke, so each message prints once.
  const warnOnce = (message: string): void => {
    if (!warned.has(message)) {
      warned.add(message);
      warn(message);
    }
  };
  return {
    set(name: string, options: CookieSerializeOptions | undefined, merged: CookieSerializeOptions, written: string | undefined): void {
      // A browser refuses some writes without an error, such as one that would replace a server-set HttpOnly cookie; it lists a nameless cookie as its bare value, so that pair is never looked for.
      const refused =
        !!written && !!name && readableHere(merged.path) && !expiresNow(merged.expires, merged.maxAge) && !`; ${document.cookie}; `.includes(`; ${written.split(';')[0]}; `);
      if (options?.httpOnly && !refused) {
        warnOnce(
          `cookies.set("${name}", …, { httpOnly: true }) ran in the browser, where document.cookie cannot set HttpOnly. The cookie is written without it, so scripts on this page can read it; set it from server code, such as a page action or API route, to keep it HttpOnly.`,
        );
      }
      if (refused) {
        warnOnce(
          `cookies.set("${name}", …) had no effect: the browser refused the write. If the server set "${name}" with HttpOnly on the same path, document.cookie cannot replace it; write it from server code, or have the server set it with httpOnly: false. Otherwise check the options: browsers refuse secure on a page served over plain HTTP, sameSite: "none" or partitioned without secure, and a domain this page is not on.`,
        );
      }
    },

    delete(name: string, options: DeleteOptions | undefined, merged: DeleteOptions, before: string): void {
      if (options?.httpOnly) {
        warnOnce(
          `cookies.delete("${name}", { httpOnly: true }) ran in the browser, where document.cookie can neither see nor remove an HttpOnly cookie. If "${name}" is HttpOnly, it is still set; delete it from server code, such as a page action or API route.`,
        );
      }
      if (readableHere(merged.path) && document.cookie === before && Cookies.get(name) !== undefined) {
        warnOnce(
          `cookies.delete("${name}") had no effect: a cookie named "${name}" is still readable on this page. Pass the path, domain and partitioned options it was set with; browsers also refuse secure on a page served over plain HTTP, and sameSite: "none" or partitioned without secure.`,
        );
      }
    },
  };
}

export function createClientCookies(checks?: ReturnType<typeof cookieWriteChecks>) {
  // The client-safe part of `cookie:defaults`, seeded by the server shell so both halves of the jar write alike.
  const defaults = (typeof window !== 'undefined' && window.__mochi_cookie_defaults) || {};
  return {
    get(name: string): string | undefined {
      return Cookies.get(name);
    },

    getAll(): Cookie[] {
      const all = Cookies.get();
      return Object.entries(all).map(([name, value]) => ({ name, value }));
    },

    has(name: string): boolean {
      return Cookies.get(name) !== undefined;
    },

    set(name: string, value: string, options?: CookieSerializeOptions): void {
      // A browser discards a document.cookie write that carries HttpOnly, so isomorphic options would make this a no-op.
      const merged = { ...defaults, ...options, httpOnly: undefined };
      // js-cookie has no maxAge option and drops falsy attributes, so Max-Age goes under its cookie name as a string to keep 0.
      const written = Cookies.set(name, value, { ...merged, maxAge: undefined, 'max-age': options?.maxAge?.toString() });
      checks?.set(name, options, merged, written);
    },

    delete(name: string, options?: DeleteOptions): void {
      const merged = { ...defaults, ...options, httpOnly: undefined };
      const before = checks ? document.cookie : '';
      Cookies.remove(name, merged);
      checks?.delete(name, options, merged, before);
    },
  };
}
