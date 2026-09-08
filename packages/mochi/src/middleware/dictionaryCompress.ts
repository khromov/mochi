import type { Handle } from '../runtime/hooks';
import { getRequestContext } from '../runtime/requestContext';
import { acceptsDcz, encodeDcz, type DictionaryStore, type ResolvedCompressionDictionary } from '../runtime/compressionDictionary';
import { appendVary, isHtmlResponse } from '../utils';

// RFC 9842 §9.2: compressing a page that also sets per-user secrets against a public dictionary is a BREACH-shaped
// oracle, so any pending Set-Cookie (jar writes land after middleware, via finalizeCookieHeaders) disables dcz.
function setsCookies(response: Response): boolean {
  if (response.headers.getSetCookie().length > 0) {
    return true;
  }
  try {
    return getRequestContext().cookies.getSetCookieHeaders().length > 0;
  } catch {
    return false;
  }
}

/** Framework-internal innermost middleware: advertises the dictionary on HTML pages and serves dcz to clients that hold it. */
export function createDictionaryHandle(opts: ResolvedCompressionDictionary, store: DictionaryStore): Handle {
  return async ({ event, resolve }) => {
    const response = await resolve(event);

    // HEAD is advertised alongside GET so a cached HEAD carries the same Vary; only GET is ever encoded.
    const method = event.request.method;
    if (event.kind !== 'page' || (method !== 'GET' && method !== 'HEAD')) {
      return response;
    }
    const current = store.current;
    if (!current || response.status !== 200 || !isHtmlResponse(response) || response.headers.get('Content-Encoding')) {
      return response;
    }

    // Both dimensions vary the bytes: the encoding chosen and whether the client holds the dictionary.
    appendVary(response.headers, 'Accept-Encoding');
    appendVary(response.headers, 'Available-Dictionary');
    response.headers.append('Link', `<${opts.dictionaryPath}/${current.hashHex}>; rel="compression-dictionary"`);

    if (method !== 'GET' || !acceptsDcz(event.request.headers.get('Accept-Encoding') ?? '')) {
      return response;
    }
    // A client may hold a previous deploy's dictionary; serve whichever one it actually has.
    const entry = store.match(event.request.headers.get('Available-Dictionary'));
    if (!entry || setsCookies(response)) {
      return response;
    }

    const framed = await encodeDcz(new Uint8Array(await response.arrayBuffer()), entry, opts.zstdLevel);
    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', 'dcz');
    headers.delete('Content-Length');
    return new Response(framed, { status: response.status, statusText: response.statusText, headers });
  };
}
