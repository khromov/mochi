/**
 * Where the selected devalue lives on disk. Build-time only — the bundler alias and the `mochi-env` templates both
 * bake this path in, and sharing one resolver keeps them pointing at one module identity. Kept out of
 * `utils/devalue.ts` because that module is reachable from browser bundles and this one needs `node:path`.
 */
import path from 'node:path';
import { toPosixPath } from '../utils/index';
import { getUseOptimizedDevalue } from '../utils/devalue';

const SRC_DIR = path.resolve(import.meta.dir, '..');
const VENDORED_ENTRY = toPosixPath(path.join(SRC_DIR, 'vendor', 'devalue', 'index.ts'));

let npmEntry: string | undefined;

/** Absolute POSIX path of the active implementation. */
export function devalueModulePath(): string {
  if (getUseOptimizedDevalue()) {
    return VENDORED_ENTRY;
  }
  npmEntry ??= toPosixPath(Bun.resolveSync('devalue', SRC_DIR));
  return npmEntry;
}
