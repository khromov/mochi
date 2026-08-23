import Cookies from '../vendor/js-cookie/index.ts';
import { logger } from '../utils/log';
import type { CookieSerializeOptions, Cookie } from './cookies';

// One line per cookie name, not per call: a reactive island can re-run its setter on every keystroke.
const warned = new Set<string>();

function warnOnce(name: string, message: string): void {
  if (warned.has(name)) {
    return;
  }
  warned.add(name);
  logger.warn(message);
}

/**
 * Whether a cookie written with these options should be readable back from this document. A `path` the current page
 * isn't under, or any `domain`, scopes the cookie somewhere `document.cookie` can't see — a successful write that
 * reads back as missing, which the checks below must not mistake for a rejected one.
 */
function isVisibleHere(options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): boolean {
  if (options?.domain) {
    return false;
  }
  const path = options?.path;
  return !path || window.location.pathname.startsWith(path);
}

export function createClientCookies() {
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
      if (options?.httpOnly) {
        warnOnce(
          name,
          `cookies.set("${name}", …, { httpOnly: true }) ran in the browser. Only a server can set HttpOnly — document.cookie cannot — so the flag was dropped. Set this cookie from a route or action instead.`,
        );
      }
      Cookies.set(name, value, options ? { ...options } : undefined);
      // A browser silently ignores a document.cookie write that would modify an existing HttpOnly cookie, so a
      // server-set session-style cookie swallows client updates with no error. Read back to catch that.
      if (isVisibleHere(options) && Cookies.get(name) !== value) {
        warnOnce(
          name,
          `cookies.set("${name}", …) had no effect in the browser. The most likely cause is a server-set HttpOnly cookie of the same name, which document.cookie may not overwrite — pass { httpOnly: false } where the server sets it if the client needs to write it too.`,
        );
      }
    },

    delete(name: string, options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): void {
      Cookies.remove(name, options ? { ...options } : undefined);
      if (isVisibleHere(options) && Cookies.get(name) !== undefined) {
        warnOnce(
          name,
          `cookies.delete("${name}") had no effect in the browser. The most likely cause is a server-set HttpOnly cookie of the same name, which document.cookie may not remove — clear it from a route or action, or set it with { httpOnly: false }.`,
        );
      }
    },
  };
}
