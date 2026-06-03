import path from 'node:path';
import { mkdirSync } from 'node:fs';

// Bun's query-string module-cache busting (`import(url + '?t=…')`) is not honored on
// every platform (notably Windows), so a rebuilt module can keep returning the stale
// version. Import a uniquely *named* copy instead: a new specifier path is always a cache
// miss. By default the copy lives beside the original so its relative chunk imports still
// resolve to the (content-stable, hashed) shared chunks emitted alongside it. Callers
// whose source has no sibling chunks (e.g. `svelte.config.js`, which lives in the project
// root) pass `tempDir` to keep the copy inside `.mochi` instead of polluting that dir.
const lastCopy = new Map<string, string>();
let epoch = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freshImport(filePath: string, opts: { tempDir?: string } = {}): Promise<any> {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = opts.tempDir ?? path.dirname(filePath);
  if (opts.tempDir) {
    mkdirSync(dir, { recursive: true });
  }
  const unique = path.join(dir, `${base}.hmr-${++epoch}${ext}`);
  await Bun.write(unique, Bun.file(filePath));
  // Best-effort cleanup of this source's previous copy so a long dev session
  // doesn't accumulate files.
  const prev = lastCopy.get(filePath);
  if (prev) {
    try {
      await Bun.file(prev).delete();
    } catch {
      /* ignore */
    }
  }
  lastCopy.set(filePath, unique);
  return import(Bun.pathToFileURL(unique).href);
}
