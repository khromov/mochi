import { randomBytes } from 'node:crypto';
import type { MochiServeOptions } from './types';
import { applyFilter } from './extensions';
import { DEFAULT_COMPRESS_MIN_BYTES } from './payloadCrypto';
import { logger } from './log';

export interface MochiContext {
  options: MochiServeOptions;
  secretKey: Buffer;
  /** Resolved `payload:compressMinBytes` filter — min payload size before deflate is attempted. */
  compressMinBytes: number;
}

// TODO: Review this for cross-request security
// Use a global singleton so that both Mochi.ts (which calls initMochiConfig())
// and compiled SSR components (which call getMochiConfig()) share the same
// instance. Without this, Bun's bundler creates a separate module copy in each
// compiled component.
const GLOBAL_KEY = '__mochi_config__';

export async function initMochiConfig(options: MochiServeOptions): Promise<void> {
  if ((globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY]) {
    throw new Error('Mochi.serve() has already been called. Only one instance is allowed.');
  }

  const envKey = process.env.MOCHI_KEY;
  const envKeyPresent = Boolean(envKey);
  if (!envKey) {
    logger.warn(
      'MOCHI_KEY is not set. A random key will be generated. ' +
        'Server island props will not survive restarts or work across multiple instances. ' +
        'Image URLs are signed with this key too, so previously-served image links will ' +
        'stop working after a restart — empty your image cache after restarting. ' +
        'Set MOCHI_KEY in your .env to a base64url-encoded 32-byte secret.',
    );
  }
  const baseKey = envKey ? Buffer.from(envKey, 'base64url') : randomBytes(32);
  const secretKey = await applyFilter('serverIsland:secretKey', baseKey, {
    options,
    envKeyPresent,
  });

  const compressMinBytes = applyFilter('payload:compressMinBytes', DEFAULT_COMPRESS_MIN_BYTES, { options });

  const ctx: MochiContext = { options, secretKey, compressMinBytes };
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = ctx;
}

export function getMochiConfig(): MochiContext {
  const ctx = (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] as MochiContext | undefined;
  if (!ctx) {
    throw new Error('Mochi.serve() has not been called yet.');
  }
  return ctx;
}
