import { getMochiConfig } from '../mochiConfig';
import { applyFilter } from '../extensions';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';
import { DEFAULT_CAPTCHA_SOLVE_BUDGET_MS } from './pow';
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

/**
 * Proof-of-work difficulty in leading zero bits. Each extra bit doubles the
 * expected work, so this is a cost dial, not a latency one: ~2^19 hashes lands
 * around a second on a desktop and a handful on a phone, which is enough to be
 * worth a spammer's while to avoid without making a real visitor wait. Raise it
 * per-app with the `bits` option or the `captcha:bits` filter.
 */
export const DEFAULT_CAPTCHA_BITS = 19;

export function resolveCaptchaOptions(opts: MochiCaptchaOptions | undefined): ResolvedCaptchaOptions {
  const o = opts ?? {};
  // Filtered before validating, so a filter can't smuggle past the bounds.
  const bits = applyFilter('captcha:bits', o.bits ?? DEFAULT_CAPTCHA_BITS, { options: o, configured: o.bits !== undefined });
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
  // Resolved here rather than per mint for the same reason as the drift
  // allowance: how long a visitor's device is given is a property of the app,
  // not of a request. A single form that wants its own bound sets the prop.
  const solveBudgetMs = applyFilter('captcha:solveBudgetMs', DEFAULT_CAPTCHA_SOLVE_BUDGET_MS, { options: o, bits });
  if (!Number.isFinite(solveBudgetMs) || solveBudgetMs <= 0) {
    throw new Error(`Captcha: solveBudgetMs must be a positive finite number, got ${solveBudgetMs}`);
  }
  return {
    bits,
    minAgeMs,
    maxAgeMs,
    driftAllowanceMs,
    solveBudgetMs,
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
