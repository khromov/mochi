import { describe, expect, test } from 'bun:test';
import { checkWsOrigin } from './csrf';

// Unit tests for the WebSocket upgrade Origin check (CSWSH defense). Mirrors the
// CSRF model: safe-by-default in production, warn-and-allow in development.

const SAME = 'http://localhost:3333';
const url = new URL(`${SAME}/socket`);
const PROD_PROXY = { origin: SAME };

function req(origin: string | null): Request {
  const headers = new Headers();
  if (origin !== null) {
    headers.set('origin', origin);
  }
  return new Request(url, { headers });
}

describe('checkWsOrigin (production)', () => {
  test('allows a same-origin upgrade', () => {
    expect(checkWsOrigin(req(SAME), url, undefined, PROD_PROXY, false)).toBeNull();
  });

  test('blocks a cross-origin upgrade with 403', () => {
    const res = checkWsOrigin(req('http://evil.example'), url, undefined, PROD_PROXY, false);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  test('blocks an upgrade with no Origin header', () => {
    const res = checkWsOrigin(req(null), url, undefined, PROD_PROXY, false);
    expect(res!.status).toBe(403);
  });

  test('allows a cross-origin upgrade listed in trustedOrigins', () => {
    expect(checkWsOrigin(req('http://evil.example'), url, { trustedOrigins: ['http://evil.example'] }, PROD_PROXY, false)).toBeNull();
  });

  test('allows any origin when checkOrigin is false', () => {
    expect(checkWsOrigin(req('http://evil.example'), url, { checkOrigin: false }, PROD_PROXY, false)).toBeNull();
  });

  test('blocks every upgrade when no expected origin is configured (safe by default)', () => {
    const res = checkWsOrigin(req(SAME), url, undefined, undefined, false);
    expect(res!.status).toBe(403);
  });
});

describe('checkWsOrigin (development)', () => {
  test('allows a cross-origin upgrade but does not block', () => {
    expect(checkWsOrigin(req('http://evil.example'), url, undefined, PROD_PROXY, true)).toBeNull();
  });

  test('allows an unconfigured-origin upgrade', () => {
    expect(checkWsOrigin(req(SAME), url, undefined, undefined, true)).toBeNull();
  });
});
