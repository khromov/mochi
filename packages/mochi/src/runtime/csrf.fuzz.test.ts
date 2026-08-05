import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import fc from 'fast-check';
import { csrfCheck, DEFAULT_FORM_CONTENT_TYPES, isFormContentType } from './csrf';

const RUNS = { numRuns: 2000 };

// csrfCheck warns on every blocked (mismatched-origin) request; the fuzzer trips
// that thousands of times, so mute the warn to keep the suite output readable.
let warnSpy: ReturnType<typeof spyOn>;
beforeAll(() => {
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

describe('isFormContentType — property-based fuzzing', () => {
  test('returns a boolean and never throws for any input', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (ct) => {
        expect(typeof isFormContentType(ct)).toBe('boolean');
      }),
      RUNS,
    );
  });

  test('a missing or empty Content-Type is always treated as form-like', () => {
    expect(isFormContentType(null)).toBe(true);
    expect(isFormContentType('')).toBe(true);
  });

  test('classification ignores case and trailing parameters', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DEFAULT_FORM_CONTENT_TYPES), fc.string(), (type, params) => {
        // `type` and `type; <params>` and its upper-cased form must all classify the same.
        expect(isFormContentType(type)).toBe(true);
        expect(isFormContentType(type.toUpperCase())).toBe(true);
        expect(isFormContentType(`${type}; ${params}`)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe('csrfCheck — property-based fuzzing', () => {
  const url = new URL('http://localhost:3333/submit');
  const proxy = { origin: 'http://localhost:3333' };

  test('never throws; always returns null or a Response for arbitrary requests', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.constantFrom('POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'), fc.string(), fc.string(), (method, origin, contentType) => {
        let request: Request;
        try {
          request = new Request(url, { method, headers: { origin, 'content-type': contentType } });
        } catch {
          return; // header value rejected by the Request constructor — not csrfCheck's concern
        }
        const out = csrfCheck(request, url, undefined, proxy, false);
        expect(out === null || out instanceof Response).toBe(true);
        checked++;
      }),
      RUNS,
    );
    // Guard against the Request-constructor escape hatch swallowing every run.
    expect(checked).toBeGreaterThan(0);
  });

  test('403s mismatched-origin protected form submissions and passes matching origins', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'),
        fc.constantFrom(...DEFAULT_FORM_CONTENT_TYPES),
        fc
          .webUrl()
          .map((u) => new URL(u).origin)
          .filter((o) => o !== proxy.origin),
        (method, contentType, crossOrigin) => {
          const blocked = csrfCheck(new Request(url, { method, headers: { origin: crossOrigin, 'content-type': contentType } }), url, undefined, proxy, false);
          expect(blocked).toBeInstanceOf(Response);
          expect((blocked as Response).status).toBe(403);

          const allowed = csrfCheck(new Request(url, { method, headers: { origin: proxy.origin, 'content-type': contentType } }), url, undefined, proxy, false);
          expect(allowed).toBeNull();
        },
      ),
      RUNS,
    );
  });
});
