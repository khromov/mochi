import path from 'node:path';

let versionPromise: Promise<string | null> | undefined;

/**
 * The framework's own package.json version, memoized for the server startup path. Resolves `null` rather than throwing
 * — a mangled install shouldn't take the caller down over a display string; callers pick their own fallback.
 * Anchored on this file's location (`src/utils/`), which holds in every layout because the package ships raw source.
 */
export function readMochiVersion(): Promise<string | null> {
  return (versionPromise ??= Bun.file(path.join(import.meta.dir, '..', '..', 'package.json'))
    .json()
    .then((pkg) => (pkg as { version: string }).version)
    .catch(() => null));
}
