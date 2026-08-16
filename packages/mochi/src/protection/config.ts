import type { MochiProtectionOptions, ResolvedProtectionOptions } from './types';

/** Four hours: long enough that real visitors rarely re-solve, short enough that a leaked clearance goes stale the same afternoon. */
export const DEFAULT_PROTECTION_MAX_AGE_MS = 14_400_000;

export const PROTECTION_AAD = 'mochi-protection';

export const PROTECTION_CLEARANCE_COOKIE = '_mochi_clearance';

/** Absolute path of the built-in interstitial component — the default `protection.page`, and the file to copy when authoring a custom one. */
export const PROTECTION_SHELL_COMPONENT = Bun.fileURLToPath(new URL('../templates/ProtectionShell/ProtectionShell.svelte', import.meta.url));

export function resolveProtectionOptions(opts: MochiProtectionOptions, fallbackBits: number): ResolvedProtectionOptions {
  const bits = opts.bits ?? fallbackBits;
  if (!Number.isInteger(bits) || bits < 1 || bits > 32) {
    throw new Error(`Protection: bits must be an integer between 1 and 32, got ${bits}`);
  }
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_PROTECTION_MAX_AGE_MS;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error(`Protection: maxAgeMs must be a positive finite number, got ${maxAgeMs}`);
  }
  if (opts.protect !== undefined && typeof opts.protect !== 'function') {
    throw new Error('Protection: protect must be a function returning a boolean');
  }
  return {
    enabled: opts.enabled,
    protect: opts.protect,
    bits,
    maxAgeMs,
    page: opts.page,
  };
}
