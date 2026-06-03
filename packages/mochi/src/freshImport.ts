import path from 'node:path';

// Bun's query-string module-cache busting (`import(url + '?t=…')`) is not honored on
// every platform (notably Windows), so a rebuilt module can keep returning the stale
// version. Import a uniquely *named* copy instead: a new specifier path is always a cache
// miss. The copy lives beside the original so its relative chunk imports still resolve to
// the (content-stable, hashed) shared chunks emitted alongside it.
const lastCopy = new Map<string, string>();
let epoch = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freshImport(filePath: string): Promise<any> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
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
