import { getMochiConfig } from '../mochiConfig';
import { MemoryNonceStore, SqliteNonceStore } from './nonceStore';
import type { MochiCaptchaOptions, NonceStore, ResolvedCaptchaOptions } from './types';

export function resolveCaptchaOptions(opts: MochiCaptchaOptions | undefined): ResolvedCaptchaOptions {
  const o = opts ?? {};
  const bits = o.bits ?? 16;
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
    throw new Error(`Captcha: bits must be an integer between 1 and 32, got ${bits}`);
  }
  const minAgeMs = o.minAgeMs ?? 2000;
  const maxAgeMs = o.maxAgeMs ?? 900_000;
  if (minAgeMs >= maxAgeMs) {
    throw new Error(`Captcha: minAgeMs (${minAgeMs}) must be less than maxAgeMs (${maxAgeMs}), or every token is rejected`);
  }
  return {
    bits,
    minAgeMs,
    maxAgeMs,
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
