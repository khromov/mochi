import { resolveBindOptions } from '../runtime/clientBind';
import type { MochiProtectionOptions, ResolvedProtectionOptions } from './types';

/** Four hours: long enough that real visitors rarely re-solve, short enough that a leaked clearance goes stale the same afternoon. */
export const DEFAULT_PROTECTION_MAX_AGE_MS = 14_400_000;

export const DEFAULT_PROTECTION_MAX_ATTEMPTS = 5;

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
  const maxAttempts = opts.maxAttempts ?? DEFAULT_PROTECTION_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`Protection: maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  const cookieName = opts.cookieName ?? PROTECTION_CLEARANCE_COOKIE;
  // RFC 6265 token characters — anything else silently breaks Set-Cookie parsing in some clients.
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName)) {
    throw new Error(`Protection: cookieName must be a valid cookie name (RFC 6265 token), got ${JSON.stringify(cookieName)}`);
  }
  return {
    enabled: opts.enabled,
    protect: opts.protect,
    bits,
    maxAgeMs,
    page: opts.page,
    blockedMessage: opts.blockedMessage,
    protectFiles: opts.protectFiles ?? true,
    maxAttempts,
    cookieName,
    bind: resolveBindOptions(opts.bind, true, 'Protection'),
  };
}

/**
 * Boot-time visibility for two production traps, mirroring `csrfBootWarning`: a per-boot random key silently
 * re-challenges every visitor on each restart, and a missing trusted origin bricks the verify POST behind CSRF —
 * the widget then burns through `maxAttempts` with no hint at the cause.
 */
export function protectionBootWarnings(options: {
  csrf?: { checkOrigin?: boolean };
  proxy?: { origin?: string; hostHeader?: string };
  filters?: { 'csrf:check'?: unknown };
}): string[] {
  const warnings: string[] = [];
  if (!process.env.MOCHI_KEY) {
    warnings.push(
      'Protection is enabled without MOCHI_KEY — the clearance key is random per boot, so every restart (and every instance in a multi-instance deploy) invalidates all clearances and re-challenges every visitor. Generate one with `mochi-framework generate-key`.',
    );
  }
  if (options.csrf?.checkOrigin !== false && options.filters?.['csrf:check'] === undefined && !options.proxy?.origin && !options.proxy?.hostHeader) {
    warnings.push(
      "Protection is enabled but no proxy.origin or proxy.hostHeader is configured — verification POSTs will fail the CSRF origin check in production, so visitors exhaust maxAttempts and stay blocked. Set Mochi.serve({ proxy: { origin: '...' } }) before deploying.",
    );
  }
  return warnings;
}
