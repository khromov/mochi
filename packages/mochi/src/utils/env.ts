// Server-only: compiled code gets these from the `mochi-env` virtual module instead, which bakes them as literals.
import { pinGlobal } from './globalState';
import { assertServerOnly } from './serverOnly';
import { logger } from './log';

assertServerOnly('isDev', 'In compiled code these constants come from the mochi-env virtual module instead.');

// Annotated, not inferred: a literal `true` narrows a user's `if (isBrowser)` to `never`.
export const isServer: boolean = true;
export const isBrowser: boolean = false;

export function resolveEnvDev(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'development';
}

// An entry imports its routes before it awaits `Mochi.serve()`, so top-level reads land here first and need a value.
export const SEEDED_IS_DEV = resolveEnvDev(process.env);

type EnvState = { dev: boolean; bindings: Array<(value: boolean) => void> };
const state = pinGlobal<EnvState>('__mochi_env_state__', () => ({ dev: SEEDED_IS_DEV, bindings: [] }));

export let isDev = state.dev;

// `export let` is live only for the copy that reassigns it, so every copy registers its own writer.
state.bindings.push((value) => {
  isDev = value;
});

let warned = false;

// Only this direction is worth warning about: the reverse merely skipped a dev-only branch in dev.
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
