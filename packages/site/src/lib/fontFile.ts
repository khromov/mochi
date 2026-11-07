import path from 'node:path';

/** Absolute path to a file in a fontsource package's `files/` directory. */
export function fontFile(pkg: string, file: string): string {
  return path.resolve(path.dirname(Bun.resolveSync(`${pkg}/package.json`, import.meta.dir)), 'files', file);
}
