import Cookies from '../vendor/js-cookie/index.ts';
import type { CookieSerializeOptions, Cookie } from './cookies';
import type {} from '../debug-bar/types';

export function createClientCookies() {
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
      Cookies.set(name, value, { ...defaults, ...options, httpOnly: undefined });
    },

    delete(name: string, options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): void {
      Cookies.remove(name, { ...defaults, ...options, httpOnly: undefined });
    },
  };
}
