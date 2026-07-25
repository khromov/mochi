/**
 * Fails a browser `Bun.build` the moment a server-only framework module is
 * resolved into the client graph.
 *
 * These modules back process-global state that only ever exists on the server
 * (the hook/filter registry, the `Mochi.serve()` singleton, the request-context
 * `AsyncLocalStorage`). Bundled into the browser they don't error — they read an
 * empty registry and hand back framework defaults, so a configured filter simply
 * stops applying with nothing in the console. Catching it at resolve time turns
 * that silent divergence into a build failure naming the importer.
 */
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { relForDisplay } from '../utils/index';

// This file lives in `src/compiler/`, so climb one level for `src/` — same
// convention as `SRC_DIR` in `ComponentRegistry.ts`.
const SRC_DIR = path.resolve(import.meta.dir, '..');

const SERVER_ONLY_MODULES = new Map<string, string>([
  [path.join(SRC_DIR, 'extensions.ts'), 'hooks and filters'],
  [path.join(SRC_DIR, 'mochiConfig.ts'), 'the Mochi.serve() config singleton'],
  [path.join(SRC_DIR, 'runtime', 'requestContext.ts'), 'the request context'],
]);

/** Injected by every browser build so `utils/serverOnly.ts` can tell which bundle it landed in. */
export const CLIENT_BUILD_DEFINE = { MOCHI_CLIENT: 'true' } as const;

// Narrow enough that the handler runs for a handful of specifiers per build; a
// user file that happens to share one of these basenames falls through to normal
// resolution below.
const CANDIDATE_SPECIFIER = /(^|[\\/])(extensions|mochiConfig|requestContext)(\.[jt]s)?$/;

export const serverOnlyModuleGuard: BunPlugin = {
  name: 'mochi-server-only-module-guard',
  setup(build) {
    build.onResolve({ filter: CANDIDATE_SPECIFIER }, (args) => {
      const base = args.resolveDir ? path.resolve(args.resolveDir, args.path) : path.resolve(args.path);
      for (const candidate of [base, `${base}.ts`]) {
        const what = SERVER_ONLY_MODULES.get(candidate);
        if (what === undefined) {
          continue;
        }
        // Thrown rather than returned as `{ errors }` because a throw is what
        // Bun surfaces into `result.logs` with `throw: false` set, which is how
        // both client builds run.
        throw new Error(
          `[mochi] ${relForDisplay(candidate)} is server-only (${what}) but was pulled into the client bundle by ${relForDisplay(args.importer)}. ` +
            'Move the client-facing part into its own module, or import it with `import type`.',
        );
      }
      return undefined;
    });
  },
};
