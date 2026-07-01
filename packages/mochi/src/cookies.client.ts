import Cookies from './vendor/js-cookie/index.ts';
import type { CookieSerializeOptions, Cookie } from './cookies';

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
      Cookies.set(name, value, options ? { ...options } : undefined);
    },

    delete(name: string, options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): void {
      Cookies.remove(name, options ? { ...options } : undefined);
    },
  };
}
