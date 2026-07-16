import { getMochiConfig } from '../mochiConfig';
import { applyFilter } from '../extensions';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';
import type { MochiCaptchaOptions, NonceStore, ResolvedCaptchaOptions } from './types';

/**
 * The timing floor: a token younger than this is refused. Not derived from
 * anything — the proof-of-work is a *cost* mechanism, not a latency one, and its
 * solve time is geometrically distributed with no lower bound, so a lucky solver
 * clears the chain in milliseconds. This number is the only thing enforcing that
 * a submission took human time, and 2s suits a form the visitor has to type
 * into. A form with nothing to fill in wants it lower — see `captcha:minAgeMs`.
 */
export const DEFAULT_CAPTCHA_MIN_AGE_MS = 2000;

/**
 * Slack added to the expiry check to absorb clock skew between the instance that
 * minted a token and the one verifying it — `ageMs` subtracts two `Date.now()`
 * reads taken on different machines. Only ever widens the expiry side: see the
 * note in `verifyCaptcha` for why the floor cannot be padded the same way.
 */
export const DEFAULT_CAPTCHA_DRIFT_ALLOWANCE_MS = 30_000;

export function resolveCaptchaOptions(opts: MochiCaptchaOptions | undefined): ResolvedCaptchaOptions {
  const o = opts ?? {};
  const bits = o.bits ?? 16;
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
    throw new Error(`Captcha: bits must be an integer between 1 and 32, got ${bits}`);
  }
  const minAgeMs = o.minAgeMs ?? DEFAULT_CAPTCHA_MIN_AGE_MS;
  const maxAgeMs = o.maxAgeMs ?? 900_000;
  if (minAgeMs >= maxAgeMs) {
    throw new Error(`Captcha: minAgeMs (${minAgeMs}) must be less than maxAgeMs (${maxAgeMs}), or every token is rejected`);
  }
  // Resolved once with the rest of the options rather than per verify: skew is a
  // property of the fleet, not of a request.
  const driftAllowanceMs = applyFilter('captcha:driftAllowanceMs', DEFAULT_CAPTCHA_DRIFT_ALLOWANCE_MS, { options: o, maxAgeMs });
  if (!Number.isFinite(driftAllowanceMs) || driftAllowanceMs < 0) {
    throw new Error(`Captcha: driftAllowanceMs must be a non-negative finite number, got ${driftAllowanceMs}`);
  }
  return {
    bits,
    minAgeMs,
    maxAgeMs,
    driftAllowanceMs,
    store: o.store ?? 'memory',
    storePath: o.storePath ?? '.mochi/captcha-nonces.sqlite',
  };
}

interface CaptchaRuntime {
  options: ResolvedCaptchaOptions;
  store: NonceStore;
}

// Pinned on globalThis like __mochi_config__: compiled Svelte components get
// their own bundled copy of this module, but every caller must share one store
// instance or a nonce burned by one copy stays spendable through another.
const GLOBAL_KEY = '__mochi_captcha_runtime__';

export function getCaptchaRuntime(): CaptchaRuntime {
  const g = globalThis as unknown as Record<string, unknown>;
  let runtime = g[GLOBAL_KEY] as CaptchaRuntime | undefined;
  if (!runtime) {
    const { options } = getMochiConfig();
    const resolved = resolveCaptchaOptions(options.captcha);
    runtime = { options: resolved, store: createStore(resolved) };
    g[GLOBAL_KEY] = runtime;
  }
  return runtime;
}

function createStore(options: ResolvedCaptchaOptions): NonceStore {
  if (options.store === 'memory') {
    return new MemoryNonceStore();
  }
  if (options.store === 'sqlite') {
    return new SqliteNonceStore(options.storePath);
  }
  return options.store;
}
