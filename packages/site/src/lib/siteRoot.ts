import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor on the site package root by walking up to the nearest package.json — a fixed
// module-relative walk breaks because dev bundles the server one directory deeper
// (`import.meta.url` lands on the non-existent `packages/site/docs`), and cwd differs
// between the dev server (`packages/site`) and the build-time barrel generator (repo root).
// The package.json walk is stable across all three.
function findSiteRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the site package root from ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
  return dir;
}

export const SITE_ROOT = findSiteRoot();
