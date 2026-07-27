import { getMochiConfig } from '../mochiConfig';
import { applyFilter } from '../extensions';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';
import { DEFAULT_CAPTCHA_SOLVE_BUDGET_MS } from './pow';
import type { MochiCaptchaOptions, NonceStore, ResolvedCaptchaOptions } from './types';

/**
 * The timing floor: a token younger than this is refused. It's a chosen number, not a derived one — proof-of-work is a
 * cost mechanism whose solve time is geometrically distributed with no lower bound, so a lucky solver clears the chain
 * in milliseconds and this is the only thing enforcing that a submission took human time. 2s suits a form the visitor
 * types into; a form with nothing to fill in wants it lower, via `captcha:minAgeMs`.
 */
export const DEFAULT_CAPTCHA_MIN_AGE_MS = 2000;

/**
 * Slack on the expiry check absorbing clock skew between the minting and verifying instances, since `ageMs` subtracts
 * two `Date.now()` reads from different machines. It widens the expiry side alone — see `verifyCaptcha` for why the
 * floor can't be padded the same way.
 */
export const DEFAULT_CAPTCHA_DRIFT_ALLOWANCE_MS = 30_000;

/**
 * Proof-of-work difficulty in leading zero bits, where each extra bit doubles the expected work — a cost dial rather
 * than a latency one. ~2^19 hashes lands around a second on a desktop and a handful on a phone, enough to be worth a
 * spammer's while to avoid without making a real visitor wait. Raise it with the `bits` option or `captcha:bits` filter.
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
  // Resolved here rather than per mint, like the drift allowance: how long a visitor's device is given is a property of
  // the app. A single form wanting its own bound sets the prop.
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

// Pinned on globalThis like `__mochi_config__`: compiled Svelte components each get their own bundled copy of this
// module, and without one shared store a nonce burned through one copy stays spendable through another.
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
