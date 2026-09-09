/**
 * Rewrites the devalue selector (`utils/devalue.ts`) to whichever implementation `useOptimizedDevalue` selected,
 * at resolve time, in every framework `Bun.build`. Bundled output then holds one devalue and none of the
 * selector's dispatch, which is what keeps a baked-in bundle and the live server flag from disagreeing.
 *
 * It deliberately never claims the bare `devalue` specifier: Svelte's own server internals import it, and a
 * blanket alias would silently swap the copy Svelte's `hydratable()` uses.
 */
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { resolveArgsPath, toPosixPath } from '../utils/index';
import { devalueModulePath } from '../utils/devalue';

const SRC_DIR = path.resolve(import.meta.dir, '..');
const SELECTOR = toPosixPath(path.join(SRC_DIR, 'utils', 'devalue.ts'));

// Narrow enough that the handler runs for a handful of specifiers per build, then matched exactly — the same
// filter-then-verify shape `serverOnlyModuleGuard` uses.
const CANDIDATE_SPECIFIER = /(^|[\\/])devalue(\.ts)?$/;

export const devalueAliasPlugin: BunPlugin = {
  name: 'mochi-devalue-alias',
  setup(build) {
    build.onResolve({ filter: CANDIDATE_SPECIFIER }, (args) => {
      // Bare `devalue` (Svelte's internals, and the selector's own import) is never ours to rewrite.
      if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) {
        return undefined;
      }
      const resolved = toPosixPath(resolveArgsPath(args));
      if (resolved !== SELECTOR && `${resolved}.ts` !== SELECTOR) {
        return undefined;
      }
      return { path: devalueModulePath() };
    });
  },
};
