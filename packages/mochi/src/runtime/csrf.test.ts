import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { csrfCheck, isFormContentType } from './csrf';
import { initExtensions } from '../extensions';

const SAME = 'http://localhost:3333';
const sameUrl = new URL(`${SAME}/submit`);

// All tests assume the framework is configured with a known public origin
// matching the dev server. The safe-by-default gate (added separately) takes
// over when this is omitted; it has its own dedicated describe block below.
const PROD_PROXY = { origin: SAME };

function req(
  method: string,
  init: {
    contentType?: string | null;
    origin?: string | null;
    accept?: string;
    extra?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers();
  if (init.contentType !== null && init.contentType !== undefined) {
    headers.set('content-type', init.contentType);
  }
  if (init.origin !== null && init.origin !== undefined) {
    headers.set('origin', init.origin);
  }
  if (init.accept) {
    headers.set('accept', init.accept);
  }
  for (const [k, v] of Object.entries(init.extra ?? {})) {
    headers.set(k, v);
  }
  return new Request(sameUrl, { method, headers });
}

describe('isFormContentType', () => {
  test('matches the three browser-form content types', () => {
    expect(isFormContentType('application/x-www-form-urlencoded')).toBe(true);
    expect(isFormContentType('multipart/form-data')).toBe(true);
    expect(isFormContentType('text/plain')).toBe(true);
  });

  test('strips parameters and is case-insensitive', () => {
    expect(isFormContentType('multipart/form-data; boundary=xyz')).toBe(true);
    expect(isFormContentType('  Multipart/Form-Data ')).toBe(true);
    expect(isFormContentType('TEXT/PLAIN; charset=utf-8')).toBe(true);
  });

  test('rejects preflighted content types', () => {
    expect(isFormContentType('application/json')).toBe(false);
    expect(isFormContentType('application/octet-stream')).toBe(false);
  });

  test('treats missing Content-Type as form-like (also a non-preflighted simple request)', () => {
    expect(isFormContentType('')).toBe(true);
    expect(isFormContentType(null)).toBe(true);
  });
});

describe('csrfCheck', () => {
  test('passes when Origin matches the expected origin', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('blocks when Origin differs and no trusted origins', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('blocks when Origin header is missing on form POST', () => {
    const r = req('POST', { contentType: 'application/x-www-form-urlencoded' });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('passes when mismatched origin is in trustedOrigins', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, { trustedOrigins: ['http://evil.example'] }, PROD_PROXY, false)).toBeNull();
  });

  test('passes JSON POSTs even with mismatched origin (CORS preflight protects them)', () => {
    const r = req('POST', { contentType: 'application/json', origin: 'http://evil.example' });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('passes octet-stream POSTs', () => {
    const r = req('POST', {
      contentType: 'application/octet-stream',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('blocks cross-origin POSTs with no Content-Type (also a non-preflighted simple request)', () => {
    const r = req('POST', { contentType: null, origin: 'http://evil.example' });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
    expect(res?.status).toBe(403);
  });

  test('passes same-origin POSTs with no Content-Type', () => {
    const r = req('POST', { contentType: null, origin: SAME });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('exempts GET, HEAD, OPTIONS regardless of origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const r = req(method, {
        contentType: 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      });
      expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
    }
  });

  test('blocks PUT, PATCH, DELETE with form content type and bad origin', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = req(method, {
        contentType: 'multipart/form-data; boundary=xyz',
        origin: 'http://evil.example',
      });
      const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
      expect(res?.status).toBe(403);
    }
  });

  test('checkOrigin: false disables the check entirely', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, { checkOrigin: false }, PROD_PROXY, false)).toBeNull();
  });

  test('returns text/plain body by default', async () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)!;
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('Cross-site POST form submissions are forbidden');
  });

  test('returns JSON body when Accept is application/json', async () => {
    const r = req('PUT', {
      contentType: 'text/plain',
      origin: 'http://evil.example',
      accept: 'application/json',
    });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)!;
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({
      message: 'Cross-site PUT form submissions are forbidden',
    });
  });

  test('multipart with boundary parameter is still checked', () => {
    const r = req('POST', {
      contentType: 'multipart/form-data; boundary=----WebKitFormBoundary',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)?.status).toBe(403);
  });
});

describe('csrfCheck with filtered formContentTypes / protectedMethods', () => {
  test('extended formContentTypes Set adds new gated content types', () => {
    const r = req('POST', {
      contentType: 'application/csp-report',
      origin: 'http://evil.example',
    });
    // Default Set: not gated → passes.
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
    // Extended Set: gated → 403.
    const extended = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'application/csp-report']);
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false, extended);
    expect(res?.status).toBe(403);
  });

  test('reduced protectedMethods Set lets removed methods pass through', () => {
    const r = req('DELETE', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    // Default Set: gated → 403.
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)?.status).toBe(403);
    // Reduced Set without DELETE: not gated → null.
    const reduced = new Set(['POST', 'PUT', 'PATCH']);
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false, undefined, reduced)).toBeNull();
  });

  test('explicit trustedOrigins Set allows the listed origin to pass', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'https://embed.example',
    });
    // Without filter: csrf.trustedOrigins defaults to empty → 403.
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)?.status).toBe(403);
    // With filter-resolved Set including the origin → null.
    const trusted = new Set(['https://embed.example']);
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false, undefined, undefined, trusted)).toBeNull();
  });
});

describe('csrfCheck in development mode', () => {
  test('cross-origin form POST returns null and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, true)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]!.join(' ');
    expect(message).toContain('would be blocked in production');
    expect(message).toContain('http://evil.example');
    warn.mockRestore();
  });

  test('missing Origin on form POST returns null and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', { contentType: 'application/x-www-form-urlencoded' });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, true)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]!.join(' ')).toContain('<missing>');
    warn.mockRestore();
  });

  test('same-origin form POST does not warn', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, true)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('checkOrigin: false short-circuits before any warning', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, { checkOrigin: false }, PROD_PROXY, true)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('production parity: development=false still returns 403', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)?.status).toBe(403);
  });
});

describe('csrfCheck with proxy options', () => {
  test('passes when Origin matches the explicit proxy.origin', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'https://my.site',
    });
    expect(csrfCheck(r, sameUrl, undefined, { origin: 'https://my.site' }, false)).toBeNull();
  });

  test('blocks when Origin matches url.origin but not the explicit proxy.origin', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME, // matches url.origin (the proxy backend) but not the public origin
    });
    const res = csrfCheck(r, sameUrl, undefined, { origin: 'https://my.site' }, false);
    expect(res?.status).toBe(403);
  });

  test('passes when Origin matches header-derived origin', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'https://my.site',
      extra: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'my.site' },
    });
    expect(
      csrfCheck(
        r,
        sameUrl,
        undefined,
        {
          protocolHeader: 'x-forwarded-proto',
          hostHeader: 'x-forwarded-host',
        },
        false,
      ),
    ).toBeNull();
  });

  test('dev warning reflects the resolved expected origin', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, { origin: 'https://my.site' }, true)).toBeNull();
    const message = warn.mock.calls[0]!.join(' ');
    expect(message).toContain('allowed: https://my.site');
    warn.mockRestore();
  });
});

describe('csrfCheck safe-by-default (no proxy config)', () => {
  test('prod + no proxy config + same-origin form POST → 403 with both messages', async () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    const res = csrfCheck(r, sameUrl, undefined, undefined, false);
    expect(res?.status).toBe(403);
    expect(res!.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await res!.text();
    expect(body).toContain('Cross-site POST form submissions are forbidden');
    expect(body).toContain('running in production mode without proxy.origin');
  });

  test('prod + no proxy config + Accept: application/json → 403 with JSON body', async () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
      accept: 'application/json',
    });
    const res = csrfCheck(r, sameUrl, undefined, undefined, false);
    expect(res?.status).toBe(403);
    expect(res!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await res!.json()) as { message: string; reason: string };
    expect(body.message).toBe('Cross-site POST form submissions are forbidden');
    expect(body.reason).toContain('running in production mode without proxy.origin');
  });

  test('prod + proxy.origin set + same-origin POST → null (passes)', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, { origin: SAME }, false)).toBeNull();
  });

  test('prod + proxy.hostHeader set + matching origin POST → null', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://my.site',
      extra: { 'x-forwarded-host': 'my.site' },
    });
    expect(csrfCheck(r, sameUrl, undefined, { hostHeader: 'x-forwarded-host' }, false)).toBeNull();
  });

  test('prod + csrf.checkOrigin: false bypasses the missing-config gate', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, { checkOrigin: false }, undefined, false)).toBeNull();
  });

  test('prod + no proxy config + GET → null (gate only applies to form mutations)', () => {
    const r = req('GET', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, undefined, false)).toBeNull();
  });

  test('prod + no proxy config + JSON POST → null (form content-type guard wins)', () => {
    const r = req('POST', { contentType: 'application/json', origin: SAME });
    expect(csrfCheck(r, sameUrl, undefined, undefined, false)).toBeNull();
  });

  test('dev + no proxy config + form POST → null and warns about missing config', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, undefined, true)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]!.join(' ');
    expect(message).toContain('would be blocked in production');
    expect(message).toContain('proxy.origin');
    warn.mockRestore();
  });

  test('dev + proxy.origin set + same-origin POST → null and does not warn', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    expect(csrfCheck(r, sameUrl, undefined, { origin: SAME }, true)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// The csrf:check filter wraps the framework default; these tests live here
// (next to the function they affect) rather than in extensions.test.ts.
describe('csrfCheck via csrf:check filter', () => {
  beforeEach(() => initExtensions({}));
  afterEach(() => initExtensions({}));

  test('returning null bypasses a default 403', () => {
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)?.status).toBe(403);
    initExtensions({ filters: { 'csrf:check': () => null } });
    expect(csrfCheck(r, sameUrl, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('returning a custom Response substitutes the framework block', () => {
    initExtensions({
      filters: {
        'csrf:check': () => new Response('go away', { status: 418 }),
      },
    });
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: SAME,
    });
    const res = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
    expect(res?.status).toBe(418);
  });

  test('filter receives the framework default decision and may delegate', () => {
    const captured: { decision?: Response | null } = {};
    initExtensions({
      filters: {
        'csrf:check': (decision) => {
          captured.decision = decision;
          return decision;
        },
      },
    });
    const r = req('POST', {
      contentType: 'application/x-www-form-urlencoded',
      origin: 'http://evil.example',
    });
    const out = csrfCheck(r, sameUrl, undefined, PROD_PROXY, false);
    // Default would block — confirm the filter saw the same Response and
    // delegating returns it unchanged.
    expect(captured.decision?.status).toBe(403);
    expect(out).toBe(captured.decision as Response);
  });
});
