// Only unbundled server code reaches this file; inside a Mochi `Bun.build` the `mochi-env` virtual module shadows
// `mochi-framework` and bakes these as literals so the opposite bundle's branches are eliminated.
import { pinGlobal } from './globalState';
import { IS_CLIENT_BUNDLE } from './serverOnly';
import { logger } from './log';

// Derived rather than hardcoded so the inferred type stays `boolean`: a literal `true` would narrow every user's
// `if (isBrowser)` to `never`.
export const isServer = !IS_CLIENT_BUNDLE;
export const isBrowser = IS_CLIENT_BUNDLE;

// Fails closed on an unset env because `bun run start` sets neither variable, so only an explicit signal may turn
// dev-only branches on in the window before `setDevelopment()`.
export function resolveEnvDev(env: Record<string, string | undefined>): boolean {
  return env.MODE === 'development' || (env.MODE === undefined && env.NODE_ENV === 'development');
}

// An entry imports its routes — and through them any `.server.ts` — before it awaits `Mochi.serve()`, so top-level
// reads land here first and need a value.
export const SEEDED_IS_DEV = resolveEnvDev(process.env);

// Pinned like the log level so a duplicate copy loading late (an SSR chunk evaluated on the first render) seeds from
// the resolved mode rather than re-reading the env.
const state = pinGlobal('__mochi_env_state__', () => ({ dev: SEEDED_IS_DEV }));

export let isDev = state.dev;

let warned = false;

// Only the seed-says-dev direction is worth a warning: it means dev-only top-level branches already ran inside a
// production process, while the reverse merely skipped one in dev and would fire on every `development: true` default.
export function setDevelopment(value: boolean, { warnOnEnvMismatch = false } = {}): void {
  if (warnOnEnvMismatch && SEEDED_IS_DEV && !value && !warned) {
    warned = true;
    logger.warn(
      'MODE (or NODE_ENV) says "development" but Mochi.serve() started with development: false. Top-level code in ' +
        'index.ts, routes.ts and .server.ts runs before serve() resolves the flag, so isDev read true there. ' +
        'Unset MODE=development for production runs.',
    );
  }
  state.dev = value;
  isDev = value;
}
