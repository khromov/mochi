export interface NonceStore {
  /** Atomically record the nonce; false if it was already seen (and not expired). */
  consume(nonce: string, expiresAt: number): boolean | Promise<boolean>;
}

export interface MochiCaptchaOptions {
  /** Proof-of-work difficulty in leading zero bits. Default: 16. */
  bits?: number;
  /** Reject tokens younger than this — the anti-bot timing floor. Default: 2000. */
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
  store: 'memory' | 'sqlite' | NonceStore;
  storePath: string;
}

export type CaptchaResult = { ok: true; nonce: string; expiresAt: number } | { ok: false; error: string };
