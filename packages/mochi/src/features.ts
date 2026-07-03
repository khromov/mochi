/**
 * Per-user feature flags. Flags are declared in `Mochi.serve({ features })` and
 * checked with `Mochi.feature(name)` (route/handler code) or the standalone
 * `feature(name)` (inside `.svelte` components, re-exported through the
 * `mochi-env` virtual module in ComponentRegistry).
 *
 * Assignment is carried by a single **encrypted, opaque** cookie (`mochi_ff`)
 * that holds only a stable random bucketing *seed* — never the list of flags a
 * user is in. Flag state is derived server-side by hashing the flag name with
 * that seed, so:
 *   - the same user deterministically resolves to the same state every request,
 *   - the cookie is tamper-proof (sealed with the framework secret), so a user
 *     can't self-assign into a flag by editing it, and
 *   - raising a flag's `rollout` only ever *adds* users (the threshold is
 *     monotonic in the hashed value).
 *
 * Because a flag check reads/writes `ctx.cookies`, the response automatically
 * gains `Vary: Cookie` (via `finalizeCookieHeaders`) — the signal a caching
 * proxy needs to key on the `mochi_ff` cookie. See `packages/docs` for the
 * exact caching-proxy configuration.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { MochiFeatureContext } from './types';
import { getMochiConfig } from './mochiConfig';
import { requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { decryptPayload, encryptPayload } from './payloadCrypto';
import { logger } from './log';

/** Cookie name carrying the encrypted per-user assignment seed. */
export const FEATURE_COOKIE = 'mochi_ff';

/** AAD binding the sealed cookie to this use, so it can't be replayed elsewhere. */
const FEATURE_AAD = 'mochi-feature-flags';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

interface FeatureCookiePayload {
  /** Schema version, for forward-compatible migrations. */
  v: 1;
  /** Stable random bucketing seed (base64url). */
  id: string;
  /** Optional sticky per-user overrides (flag → forced state). */
  o?: Record<string, boolean>;
}

// Per-request memo so repeated checks in one request don't re-decrypt the cookie.
const payloadCache = new WeakMap<MochiRequestContext, FeatureCookiePayload>();

const warnedUnknown = new Set<string>();

function isPayload(value: unknown): value is FeatureCookiePayload {
  return typeof value === 'object' && value !== null && (value as FeatureCookiePayload).v === 1 && typeof (value as FeatureCookiePayload).id === 'string';
}

/**
 * Read the assignment payload for this request. Returns `minted: true` when a
 * fresh seed had to be created (missing, tampered, or malformed cookie) — the
 * caller decides when to persist it, so the cookie is written at most once per
 * request rather than on every mint.
 */
function loadPayload(ctx: MochiRequestContext): { payload: FeatureCookiePayload; minted: boolean } {
  const cached = payloadCache.get(ctx);
  if (cached) {
    return { payload: cached, minted: false };
  }

  const token = ctx.cookies.get(FEATURE_COOKIE);
  if (token) {
    const json = decryptPayload(token, { aad: FEATURE_AAD });
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json);
        if (isPayload(parsed)) {
          payloadCache.set(ctx, parsed);
          return { payload: parsed, minted: false };
        }
      } catch {
        // fall through to mint a fresh seed
      }
    }
  }

  const payload: FeatureCookiePayload = { v: 1, id: randomBytes(16).toString('base64url') };
  payloadCache.set(ctx, payload);
  return { payload, minted: true };
}

/** Seal the payload and write it back to the cookie jar. */
function persist(ctx: MochiRequestContext, payload: FeatureCookiePayload): void {
  payloadCache.set(ctx, payload);
  ctx.cookies.set(FEATURE_COOKIE, encryptPayload(JSON.stringify(payload), { aad: FEATURE_AAD }), {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
  });
}

/**
 * Deterministic bucket in `[0, 1)` for a (flag, seed) pair. HMAC with the
 * framework secret means clients can't predict which seed lands in which bucket.
 */
function bucket(name: string, id: string): number {
  const digest = createHmac('sha256', getMochiConfig().secretKey).update(`feature:${name}:${id}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

function toFeatureContext(ctx: MochiRequestContext): MochiFeatureContext {
  return { request: ctx.request, url: ctx.url, locals: ctx.locals, cookies: ctx.cookies };
}

/**
 * Resolve a feature flag's state for the current user. Returns `false` for an
 * unknown flag or when called outside a request (no per-user context).
 */
export function evaluateFeature(name: string): boolean {
  const flags = getMochiConfig().options.features;
  const flag = flags?.[name];
  if (!flag) {
    if (!warnedUnknown.has(name)) {
      warnedUnknown.add(name);
      logger.warn(`Mochi.feature(${JSON.stringify(name)}) checked an undeclared flag — resolving to false. Declare it in Mochi.serve({ features }).`);
    }
    return false;
  }

  const ctx = requestContext.getStore();
  if (!ctx) {
    logger.warn(`Mochi.feature(${JSON.stringify(name)}) was called outside of a request — resolving to false. Feature flags are per-user and need a request context.`);
    return false;
  }

  // 1. Targeting predicate wins if it returns a concrete boolean.
  if (flag.target) {
    const targeted = flag.target(toFeatureContext(ctx));
    if (typeof targeted === 'boolean') {
      return targeted;
    }
  }

  const { payload, minted } = loadPayload(ctx);
  // A freshly minted seed must be written back so the user's bucket is stable
  // across requests (otherwise every request re-rolls).
  if (minted) {
    persist(ctx, payload);
  }

  // 2. Sticky per-user override.
  if (payload.o && name in payload.o) {
    return payload.o[name]!;
  }

  // 3. Deterministic percentage bucketing.
  return bucket(name, payload.id) < (flag.rollout ?? 0);
}

/** Standalone alias of {@link evaluateFeature}; the `.svelte`-facing entry point. */
export function feature(name: string): boolean {
  return evaluateFeature(name);
}

/**
 * Set or clear a sticky per-user override for a flag, stored (encrypted) in the
 * user's cookie so it survives across requests. Pass `null` to clear the
 * override and fall back to targeting/bucketing. Throws outside a request.
 */
export function setFeatureOverride(name: string, enabled: boolean | null): void {
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error('setFeatureOverride() called outside of a request.');
  }
  const { payload } = loadPayload(ctx);
  const overrides = { ...payload.o };
  if (enabled === null) {
    delete overrides[name];
  } else {
    overrides[name] = enabled;
  }
  const next: FeatureCookiePayload = { ...payload, o: Object.keys(overrides).length > 0 ? overrides : undefined };
  persist(ctx, next);
}
