import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor on the site package root, located by walking up to the nearest
// package.json. A fixed module-relative walk (`../../../docs`) is wrong because
// in dev the whole server is bundled into `.mochi/dev/entry-hmr/entry.js`, so
// `import.meta.url` sits one directory deeper than the source and the walk lands
// at the non-existent `packages/site/docs`. cwd is no anchor either: the dev
// server runs from `packages/site` but the build-time barrel generator runs from
// the repo root. The package.json walk is stable across all three.
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
