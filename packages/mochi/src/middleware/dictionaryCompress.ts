import type { Handle } from '../runtime/hooks';
import { getRequestContext } from '../runtime/requestContext';
import { acceptsDcz, buildDczResponseBody, getDictionaryState, hashesEqual, parseAvailableDictionary, type ResolvedDictionaryOptions } from '../runtime/dictionary';
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
export function createDictionaryHandle(opts: ResolvedDictionaryOptions): Handle {
  return async ({ event, resolve }) => {
    const response = await resolve(event);

    if (event.kind !== 'page' || event.request.method !== 'GET') {
      return response;
    }
    const state = getDictionaryState();
    if (!state || response.status !== 200 || !isHtmlResponse(response) || response.headers.get('Content-Encoding')) {
      return response;
    }

    // Both dimensions vary the bytes: the encoding chosen and whether the client holds the dictionary.
    appendVary(response.headers, 'Accept-Encoding');
    appendVary(response.headers, 'Available-Dictionary');
    response.headers.append('Link', `<${opts.dictionaryPath}>; rel="compression-dictionary"`);

    if (!acceptsDcz(event.request.headers.get('Accept-Encoding') ?? '')) {
      return response;
    }
    const advertised = parseAvailableDictionary(event.request.headers.get('Available-Dictionary'));
    if (!advertised || !hashesEqual(advertised, state.hash)) {
      return response;
    }
    if (setsCookies(response)) {
      return response;
    }

    const payload = new Uint8Array(await response.arrayBuffer());
    const body = await buildDczResponseBody(payload, state, opts.level);

    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', 'dcz');
    headers.delete('Content-Length');
    return new Response(body as unknown as BodyInit, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
