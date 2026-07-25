export interface NonceStore {
  /** Atomically record the nonce; false if it was already seen (and not expired). */
  consume(nonce: string, expiresAt: number): boolean | Promise<boolean>;
  /** Release any held resources (e.g. a SQLite handle). Optional. */
  close?(): void | Promise<void>;
}

export interface MochiCaptchaOptions {
  /** Proof-of-work difficulty in leading zero bits. Default: 16. */
  bits?: number;
  /**
   * Reject tokens younger than this — the anti-bot timing floor, and the only
   * check enforcing that a submission took human time (the proof-of-work bounds
   * an attacker's *cost*, not any individual solver's latency). Override it
   * per-form with the `captcha:minAgeMs` filter. Default: 2000.
   */
  minAgeMs?: number;
  /** Reject tokens older than this. Default: 900_000 (15 minutes). */
  maxAgeMs?: number;
  /**
   * Replay store for one-time nonces. `'memory'` is per-process and gives no
   * protection across a multi-instance deploy — use `'sqlite'` or your own
   * store there. Default: `'memory'`.
   */
  store?: 'memory' | 'sqlite' | NonceStore;
  /** SQLite file when `store: 'sqlite'`. Default: `.mochi/captcha-nonces.sqlite`. */
  storePath?: string;
}

export interface ResolvedCaptchaOptions {
  bits: number;
  minAgeMs: number;
  maxAgeMs: number;
  /** Clock-skew slack added to `maxAgeMs`. Filter-only — see `captcha:driftAllowanceMs`. */
  driftAllowanceMs: number;
  /** Active solve time the widget spends before giving up. Filter-only — see `captcha:solveBudgetMs`; per-widget it's the `solveBudgetMs` prop. */
  solveBudgetMs: number;
  store: 'memory' | 'sqlite' | NonceStore;
  storePath: string;
}

/**
 * Why a token was refused, coarse enough to hand to the client. Every failure a
 * bot could probe with — tampered, too fast, expired, bad proof-of-work —
 * collapses into `'rejected'`, so branching on this can't leak the timing floor.
 * `'replay'` stays distinct because it is already public: it's the one failure
 * the visitor can act on, and reaching it costs a genuinely solved captcha.
 * Operators get the real cause from the `captcha:verify` event.
 */
export type CaptchaFailureReason = 'replay' | 'rejected';

export type CaptchaResult = { ok: true; nonce: string; expiresAt: number } | { ok: false; reason: CaptchaFailureReason; error: string };
