/**
 * Chooses between the vendored devalue fork (`vendor/devalue/`, the default) and the npm `devalue` dependency,
 * per `Mochi.serve({ useOptimizedDevalue })`. Both emit byte-identical output, so this only trades CPU.
 *
 * Every framework file imports devalue through here rather than the bare specifier, because the choice has to
 * reach four places: the unbundled server runtime, compiled SSR chunks, browser bundles, and the build process.
 * Inside a bundle there is no flag to read — `compiler/devalueAlias.ts` rewrites this module to the chosen
 * implementation at resolve time, so a bundle contains one copy and never this dispatch. That is also what stops
 * the runtime flag and the baked-in one from disagreeing: they read the same `state` in the only process that
 * has both.
 *
 * This module is reachable from browser bundles, so it imports leaf modules only — no `node:*`, no `utils/index.ts`
 * (which pulls in `node:http` and `negotiator`). Resolving the chosen implementation's *path* is a build-time
 * concern and lives in `compiler/devaluePath.ts`.
 *
 * A bundled importer may therefore only use the pass-through names below — anything else (`setUseOptimizedDevalue`,
 * `devalueErrorPath`) fails the build with "No matching export" once the alias swaps this file out.
 */
import * as npmDevalue from 'devalue';
import * as vendoredDevalue from '../vendor/devalue/index.ts';
import { pinGlobal } from './globalState';

// Pinned so the value survives the duplicate module copies Bun's bundler creates, the same reason
// `mochiConfig.ts` and the request context pin theirs.
const state = pinGlobal('__mochi_devalue__', () => ({ optimized: true }));

export function setUseOptimizedDevalue(optimized: boolean): void {
  state.optimized = optimized;
}

export function getUseOptimizedDevalue(): boolean {
  return state.optimized;
}

function impl(): typeof npmDevalue {
  return (state.optimized ? vendoredDevalue : npmDevalue) as typeof npmDevalue;
}

export const stringify: typeof npmDevalue.stringify = (value, reducers?, options?) => impl().stringify(value, reducers, options);
export const parse: typeof npmDevalue.parse = (serialized, revivers?, options?) => impl().parse(serialized, revivers, options);
export const uneval: typeof npmDevalue.uneval = (value, replacer?) => impl().uneval(value, replacer);

/**
 * The `.path` of a devalue serialization failure, or `undefined` for any other error. Matched by shape rather than
 * `instanceof`: the npm copy, the vendored copy and the copy baked into a compiled chunk are three distinct classes,
 * and `instanceof` crosses none of them.
 */
export function devalueErrorPath(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'DevalueError') {
    return undefined;
  }
  const errorPath = (error as Error & { path?: unknown }).path;
  return typeof errorPath === 'string' ? errorPath : undefined;
}
