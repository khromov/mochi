import { randomBytes } from 'node:crypto';
import type { MochiServeOptions } from './types';
import { applyFilter } from './extensions';
import { logger } from './utils/log';
import { assertServerOnly } from './utils/serverOnly';

export interface MochiContext {
  options: MochiServeOptions;
  secretKey: Buffer;
}

// TODO: Review this for cross-request security
// Use a global singleton so that both Mochi.ts (which calls initMochiConfig())
// and compiled SSR components (which call getMochiConfig()) share the same
// instance. Without this, Bun's bundler creates a separate module copy in each
// compiled component.
const GLOBAL_KEY = '__mochi_config__';

const SERVER_ONLY_REASON = 'The Mochi.serve() config singleton — and the secret key it holds — only exists in the server process.';

export async function initMochiConfig(options: MochiServeOptions): Promise<void> {
  assertServerOnly('initMochiConfig()', SERVER_ONLY_REASON);
  // This one-per-process singleton (never cleared by server.stop()) is why
  // server-booting tests must run one file per process via runTests
  // (cli/testing.ts) rather than a plain `bun test` over the whole suite —
  // the second Mochi.serve() in a shared process lands here and throws.
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
  if (envKey && baseKey.length < 32) {
    logger.warn(
      `MOCHI_KEY decoded to only ${baseKey.length} bytes — this is likely a typo or truncated value. ` +
        'A short key yields a low-entropy secret for signing island props and image URLs. ' +
        'Generate a proper one with `bunx mochi-framework generate-key`.',
    );
  }
  const secretKey = await applyFilter('serverIsland:secretKey', baseKey, {
    options,
    envKeyPresent,
  });

  const ctx: MochiContext = { options, secretKey };
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = ctx;
}

export function getMochiConfig(): MochiContext {
  assertServerOnly('getMochiConfig()', SERVER_ONLY_REASON);
  const ctx = (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] as MochiContext | undefined;
  if (!ctx) {
    throw new Error('Mochi.serve() has not been called yet.');
  }
  return ctx;
}

export function getAssetPrefix(): string {
  return getMochiConfig().options.assetPrefix ?? '/_mochi';
}
