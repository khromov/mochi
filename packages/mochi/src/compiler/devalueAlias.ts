/**
 * Rewrites the devalue selector (`utils/devalue.ts`) to whichever implementation `useOptimizedDevalue` selected,
 * at resolve time, in every framework `Bun.build`. Bundled output then holds one devalue and none of the
 * selector's dispatch, which is what keeps a baked-in bundle and the live server flag from disagreeing.
 *
 * It deliberately never claims the bare `devalue` specifier: Svelte's own server internals import it, and a
 * blanket alias would silently swap the copy Svelte's `hydratable()` uses.
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';
import { resolveArgsPath, toPosixPath } from '../utils/index';
import { devalueModulePath } from './devaluePath';

const SRC_DIR = path.resolve(import.meta.dir, '..');
const SELECTOR = toPosixPath(realpathSync(path.join(SRC_DIR, 'utils', 'devalue.ts')));
const SELECTOR_SUFFIX = '/src/utils/devalue.ts';

// Narrow enough that the handler runs for a handful of specifiers per build, then matched exactly — the same
// filter-then-verify shape `serverOnlyModuleGuard` uses.
const CANDIDATE_SPECIFIER = /(^|[\\/])devalue(\.ts)?$/;

/** Realpath, because a `workspace:*` consumer reaches the framework through a symlinked `node_modules/mochi-framework`: the importer's resolved specifier and this file's own `import.meta.dir` then spell one file two ways, and a plain compare would miss. */
function realPosixPath(p: string): string {
  try {
    return toPosixPath(realpathSync(p));
  } catch {
    return toPosixPath(p);
  }
}

/**
 * Missing a selector is silent and expensive — the dispatch bundles verbatim, pulling both devalue copies (and, for a
 * browser build, `node:path`) in — so a second physical copy of the framework counts too. It is identified by the
 * sibling it dispatches to, which a user file that happens to be named `devalue.ts` will not have.
 */
function isSelector(resolved: string): boolean {
  // The extension goes on first: framework code imports the selector without one, and realpath needs a real file.
  const real = realPosixPath(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
  if (real === SELECTOR) {
    return true;
  }
  return real.endsWith(SELECTOR_SUFFIX) && existsSync(path.join(path.dirname(real), '..', 'vendor', 'devalue', 'index.ts'));
}

export const devalueAliasPlugin: BunPlugin = {
  name: 'mochi-devalue-alias',
  setup(build) {
    build.onResolve({ filter: CANDIDATE_SPECIFIER }, (args) => {
      // Bare `devalue` (Svelte's internals, and the selector's own import) is never ours to rewrite.
      if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) {
        return undefined;
      }
      return isSelector(toPosixPath(resolveArgsPath(args))) ? { path: devalueModulePath() } : undefined;
    });
  },
};
