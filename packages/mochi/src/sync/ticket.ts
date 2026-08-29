/**
 * Signed short-lived tickets bridging Mochi's request-context auth to reflectdb's bearer-token auth callback.
 *
 * reflectdb only ever hands its `auth()` callback a synthesized Request carrying `Authorization: Bearer <token>` — it
 * never sees the real cookies. So Mochi mints a ticket at a token endpoint (where full request context is available),
 * and reflectdb verifies it as the bearer token, re-checking per ops batch. The signing key derives from the framework
 * `secretKey`, so no separate secret is needed.
 *
 *   ticket = base64url(json{ auth, exp }) + '.' + base64url(HMAC-SHA256(key, payloadPart))
 *
 * A ticket may be honored slightly past `exp` on reflectdb's ops path, bounded by reflectdb's internal auth-cache TTL;
 * expiry ultimately triggers reflectdb's `reauth`, and the client refetches a fresh ticket.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthContext } from 'reflectdb';
import { getMochiConfig } from '../mochiConfig';

interface TicketPayload {
  auth: AuthContext;
  exp: number;
}

// Memoized per secret — the derivation is pure in `secretKey`, and re-keying on the secret handles tests that
// reconfigure. Mirrors `sivKey()` in `islands/payloadCrypto.ts`.
let cachedKey: { secret: Buffer; key: Buffer } | undefined;
function ticketKey(): Buffer {
  const secret = getMochiConfig().secretKey;
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = { secret, key: createHmac('sha512', secret).update('mochi-sync-ticket-v1').digest() };
  }
  return cachedKey.key;
}

function sign(payloadPart: string): string {
  return createHmac('sha256', ticketKey()).update(payloadPart).digest('base64url');
}

/** Mint a ticket for `auth`, valid for `ttlMs` from now. */
export function mintSyncTicket(auth: AuthContext, ttlMs: number): string {
  const payload: TicketPayload = { auth, exp: Date.now() + ttlMs };
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${payloadPart}.${sign(payloadPart)}`;
}

/** Verify a ticket, returning its `AuthContext` or `null` on bad signature, malformed shape, or expiry. */
export function verifySyncTicket(token: string): AuthContext | null {
  const dot = token.indexOf('.');
  if (dot <= 0) {
    return null;
  }
  const payloadPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadPart);
  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as TicketPayload;
    if (typeof payload?.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }
    if (!payload.auth || typeof payload.auth.userId !== 'string') {
      return null;
    }
    return payload.auth;
  } catch {
    return null;
  }
}
