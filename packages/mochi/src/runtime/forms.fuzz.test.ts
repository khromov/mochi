import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { fail, isFormFail, isFormRedirect, isFormSuccess, redirect, success } from './forms';
import { isEnhanceRequest } from './formsJson';

const RUNS = { numRuns: 2000 };

const redirectStatus = fc.constantFrom(301, 302, 303, 307, 308) as fc.Arbitrary<301 | 302 | 303 | 307 | 308>;
// devalue-serializable record values (the enhance envelope runs these through devalue).
const record = fc.dictionary(fc.string(), fc.jsonValue());

describe('form action results — property-based fuzzing', () => {
  test('each constructor is recognized by exactly one guard', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), record, (status, data) => {
        const f = fail(status, data);
        expect([isFormFail(f), isFormRedirect(f), isFormSuccess(f)]).toEqual([true, false, false]);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(record, (data) => {
        const s = success(data);
        expect([isFormFail(s), isFormRedirect(s), isFormSuccess(s)]).toEqual([false, false, true]);
      }),
      RUNS,
    );
    fc.assert(
      fc.property(redirectStatus, fc.string(), (status, location) => {
        const r = redirect(status, location);
        expect([isFormFail(r), isFormRedirect(r), isFormSuccess(r)]).toEqual([false, true, false]);
      }),
      RUNS,
    );
  });

  test('guards return a boolean and never throw on arbitrary junk', () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        expect(typeof isFormFail(v)).toBe('boolean');
        expect(typeof isFormRedirect(v)).toBe('boolean');
        expect(typeof isFormSuccess(v)).toBe('boolean');
      }),
      RUNS,
    );
  });
});

describe('isEnhanceRequest — property-based fuzzing', () => {
  test('returns a boolean and never throws for arbitrary method / headers', () => {
    fc.assert(
      fc.property(fc.constantFrom('POST', 'GET', 'PUT', 'HEAD'), fc.string(), fc.constantFrom('true', 'false', ''), (method, accept, actionHeader) => {
        let request: Request;
        try {
          request = new Request('http://localhost:3333/submit', {
            method,
            headers: { accept, 'x-mochi-action': actionHeader },
          });
        } catch {
          return; // unparseable header value — not isEnhanceRequest's concern
        }
        expect(typeof isEnhanceRequest(request)).toBe('boolean');
      }),
      RUNS,
    );
  });
});
