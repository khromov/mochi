import Cookies from '../vendor/js-cookie/index.ts';
import type { CookieSerializeOptions, Cookie } from './cookies';
import type {} from '../debug-bar/types';

type DeleteOptions = Omit<CookieSerializeOptions, 'maxAge' | 'expires'>;

// A cookie scoped to a path this page is not under is stored but never readable here, so a read-back must not count it as refused.
function readableHere(path: string | undefined): boolean {
  const here = window.location.pathname;
  return !path || here === path || (here.startsWith(path) && (path.endsWith('/') || here[path.length] === '/'));
}

function expiresNow(expires: number | Date | undefined): boolean {
  return typeof expires === 'number' ? expires <= 0 : expires !== undefined && expires.getTime() <= Date.now();
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
      if (options?.httpOnly) {
        warnOnce(
          `cookies.set("${name}", …, { httpOnly: true }) ran in the browser, where document.cookie cannot set HttpOnly. The cookie is written without it, so scripts on this page can read it; set it from server code, such as a page action or API route, to keep it HttpOnly.`,
        );
      }
      // A browser refuses some writes without an error, such as one that would replace a server-set HttpOnly cookie.
      if (written && readableHere(merged.path) && !expiresNow(merged.expires) && !`; ${document.cookie}; `.includes(`; ${written.split(';')[0]}; `)) {
        warnOnce(
          `cookies.set("${name}", …) had no effect: the browser refused the write. Common causes are a cookie of the same name and path that the server set with HttpOnly, which document.cookie cannot replace, and options the browser rejects, such as secure on a page served over plain HTTP or a domain this page is not on.`,
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
          `cookies.delete("${name}") had no effect: a cookie named "${name}" is still readable on this page. Pass the path, domain and partitioned options it was set with; the browser also refuses secure on a page served over plain HTTP.`,
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
      const written = Cookies.set(name, value, merged);
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
