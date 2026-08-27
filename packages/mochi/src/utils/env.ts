// Only unbundled server code reaches this file; inside a Mochi `Bun.build` the `mochi-env` virtual module shadows
// `mochi-framework` and bakes these as literals so the opposite bundle's branches are eliminated.
import { pinGlobal } from './globalState';
import { IS_CLIENT_BUNDLE } from './serverOnly';
import { logger } from './log';

// Derived rather than hardcoded so the inferred type stays `boolean`: a literal `true` would narrow every user's
// `if (isBrowser)` to `never`.
export const isServer = !IS_CLIENT_BUNDLE;
export const isBrowser = IS_CLIENT_BUNDLE;

// Fails closed on anything else — `bun run start` leaves NODE_ENV unset and `bun test` sets it to "test" — so only an
// explicit signal turns dev-only branches on in the window before `setDevelopment()`.
export function resolveEnvDev(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'development';
}

// An entry imports its routes — and through them any `.server.ts` — before it awaits `Mochi.serve()`, so top-level
// reads land here first and need a value.
export const SEEDED_IS_DEV = resolveEnvDev(process.env);

// Pinned like the log level so a duplicate copy loading late (an SSR chunk evaluated on the first render) seeds from
// the resolved mode rather than re-reading the env.
type EnvState = { dev: boolean; bindings: Array<(value: boolean) => void> };
const state = pinGlobal<EnvState>('__mochi_env_state__', () => ({ dev: SEEDED_IS_DEV, bindings: [] }));

export let isDev = state.dev;

// `export let` is a live binding only for the copy that reassigns it, so every copy registers its own writer here:
// without this a second copy loaded before setDevelopment() would keep the seed forever while state.dev moved on.
state.bindings.push((value) => {
  isDev = value;
});

let warned = false;

// Only the seed-says-dev direction is worth a warning: it means dev-only top-level branches already ran inside a
// production process, while the reverse merely skipped one in dev and would fire on every `development: true` default.
export function setDevelopment(value: boolean, { warnOnEnvMismatch = false } = {}): void {
  if (warnOnEnvMismatch && SEEDED_IS_DEV && !value && !warned) {
    warned = true;
    logger.warn(
      'NODE_ENV is "development" but Mochi.serve() started with development: false. Top-level code in index.ts, ' +
        'routes.ts and .server.ts runs before serve() resolves the flag, so isDev read true there. ' +
        'Unset NODE_ENV=development for production runs.',
    );
  }
  state.dev = value;
  for (const write of state.bindings) {
    write(value);
  }
}
