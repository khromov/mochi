// Vendored from https://github.com/sveltejs/devalue/tree/bc3ef3a 5.9.2+bc3ef3a
//
// A FORK, not a plain release: devalue 5.9.2 plus the unreleased commit bc3ef3a ("perf: speed up stringify,
// parse and uneval"). Output is byte-identical to the published package — `src/devalueParity.test.ts` asserts
// that against the npm copy, which is why `devalue` stays a dependency. Selected by
// `Mochi.serve({ useOptimizedDevalue })`.
//
// Everything under ./src/ is upstream verbatim and prettier-ignored, so re-syncing an upstream release stays a
// file copy rather than a re-port. Never re-vendor this folder from `npm pack devalue` — that silently reverts
// the perf commit. This file is the only Mochi-authored source here; it mirrors upstream's index.js.

export { stringify, stringifyAsync } from './src/stringify.js';
export { parse, unflatten } from './src/parse.js';
export { uneval } from './src/uneval.js';
export { DevalueError, filter_array_indices as filterArrayIndices } from './src/utils.js';
export { default_stringify_operations as defaultStringifyOperations, default_parse_operations as defaultParseOperations } from './src/operations.js';

export type {
  DefaultParseOperations,
  DefaultStringifyOperations,
  ParseOperations,
  ParseOptions,
  StringifyOperations,
  StringifyOptions,
  StringValueTag,
  TypedArray,
  ViewTag,
} from './src/types.js';
