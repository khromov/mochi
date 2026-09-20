import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Absolute, symlink-free spelling of a build out-dir. Bun's resolver canonicalises symlinks and caches what it finds
 * under the real path, so emitting an intermediate SSR module through one spelling and importing it through another
 * makes a later compile pass miss the artifact it just wrote (`--out-dir /var/…` on macOS, where `/var` is a symlink).
 * The out-dir need not exist yet: the deepest existing ancestor is canonicalised and the rest appended.
 */
export function resolveOutDir(outDir: string): string {
  const abs = path.resolve(outDir);
  const missing: string[] = [];
  let existing = abs;
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...missing);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) {
        return abs;
      }
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}
