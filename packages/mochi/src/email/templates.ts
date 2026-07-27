import { statSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils';

/**
 * Conventional location for `Mochi.email({ component })` templates. The build can't discover an email template the way
 * it discovers pages — nothing references it from a route, so there is no import graph to walk — so it walks this
 * directory instead. A template outside it still renders, but compiles on the first send in production.
 */
export const EMAIL_TEMPLATE_DIR = 'src/emails';

/**
 * Email templates to seed into the build's SSR entrypoints, cwd-relative and forward-slash on every platform. Sorted so
 * a rebuild of unchanged sources produces a byte-identical manifest.
 */
export function scanEmailTemplates(cwd: string = process.cwd()): string[] {
  const dir = path.join(cwd, EMAIL_TEMPLATE_DIR);
  // isDirectory() rather than a bare existence check: `scanSync` throws on a plain file of that name, which would abort
  // the build over something that isn't an email template at all.
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const glob = new Bun.Glob('**/*.svelte');
  return [...glob.scanSync(dir)].map((f) => toPosixPath(path.join(EMAIL_TEMPLATE_DIR, f))).sort();
}
