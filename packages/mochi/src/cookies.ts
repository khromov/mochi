import { parse, serialize } from 'cookie';
import { appendVary } from './utils';

export interface CookieSerializeOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: number | Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None' | 'strict' | 'lax' | 'none';
  priority?: 'Low' | 'Medium' | 'High';
  partitioned?: boolean;
}

export interface Cookie {
  name: string;
  value: string;
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) {
    return map;
  }
  const parsed = parse(header);
  for (const [name, value] of Object.entries(parsed)) {
    if (value !== undefined) {
      map.set(name, value);
    }
  }
  return map;
}

function serializeCookie(name: string, value: string, options?: CookieSerializeOptions): string {
  if (!options) {
    return serialize(name, value);
  }

  const cookieOpts: import('cookie').SerializeOptions = {
    path: options.path,
    domain: options.domain,
    maxAge: options.maxAge,
    httpOnly: options.httpOnly,
    secure: options.secure,
    partitioned: options.partitioned,
  };

  if (options.expires != null) {
    cookieOpts.expires = typeof options.expires === 'number' ? new Date(Date.now() + options.expires * 864e5) : options.expires;
  }

  if (options.sameSite) {
    cookieOpts.sameSite = options.sameSite.toLowerCase() as 'lax' | 'strict' | 'none';
  }

  if (options.priority) {
    cookieOpts.priority = options.priority.toLowerCase() as 'low' | 'medium' | 'high';
  }

  return serialize(name, value, cookieOpts);
}

export class MochiCookieJar {
  private parsed: Map<string, string>;
  private outgoing: string[] = [];
  private accessed = false;
  private readonly defaults: CookieSerializeOptions;

  constructor(cookieHeader: string | null, defaults: CookieSerializeOptions = {}) {
    this.parsed = parseCookieHeader(cookieHeader);
    this.defaults = defaults;
  }

  get(name: string): string | undefined {
    this.accessed = true;
    return this.parsed.get(name);
  }

  getAll(): Cookie[] {
    this.accessed = true;
    return [...this.parsed.entries()].map(([name, value]) => ({ name, value }));
  }

  /**
   * Returns a snapshot of incoming cookies without flipping `accessed`. Used by
   * the debug bar to inspect cookies without forcing `Vary: Cookie` onto every
   * response.
   */
  peekAll(): Cookie[] {
    return [...this.parsed.entries()].map(([name, value]) => ({ name, value }));
  }

  has(name: string): boolean {
    this.accessed = true;
    return this.parsed.has(name);
  }

  set(name: string, value: string, options?: CookieSerializeOptions): void {
    this.accessed = true;
    this.parsed.set(name, value);
    this.outgoing.push(serializeCookie(name, value, { ...this.defaults, ...options }));
  }

  delete(name: string, options?: Pick<CookieSerializeOptions, 'path' | 'domain'>): void {
    this.accessed = true;
    this.parsed.delete(name);
    // path/domain from the resolved defaults must apply, otherwise the browser
    // won't match the original Set-Cookie and the cookie won't be deleted.
    this.outgoing.push(
      serializeCookie(name, '', {
        path: this.defaults.path,
        domain: this.defaults.domain,
        ...options,
        maxAge: 0,
      }),
    );
  }

  /** Returns accumulated Set-Cookie header strings for the response. */
  getSetCookieHeaders(): string[] {
    return this.outgoing;
  }

  /** True if any cookie was read or written through this jar. */
  wasAccessed(): boolean {
    return this.accessed;
  }
}

/**
 * Apply Set-Cookie headers and `Vary: Cookie` to the response when the jar was
 * touched. Returns the original response untouched if no cookies were read or
 * written, or a clone with the headers attached otherwise (Response headers
 * become immutable once the body has been read).
 */
export function finalizeCookieHeaders(response: Response, cookieJar: MochiCookieJar): Response {
  const setCookies = cookieJar.getSetCookieHeaders();
  const needsVary = cookieJar.wasAccessed();
  if (setCookies.length === 0 && !needsVary) {
    return response;
  }
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const header of setCookies) {
    newResponse.headers.append('Set-Cookie', header);
  }
  if (needsVary) {
    appendVary(newResponse.headers, 'Cookie');
  }
  return newResponse;
}
