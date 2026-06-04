import path from 'node:path';
import { mkdirSync } from 'node:fs';

// Bun's query-string module-cache busting (`import(url + '?t=…')`) is not honored on
// every platform (notably Windows), so a rebuilt module can keep returning the stale
// version. Import a uniquely *named* artifact instead: a new specifier path is always a
// cache miss.
const lastArtifact = new Map<string, string>();
let epoch = 0;

// Write a uniquely-named artifact for `sourcePath` into `dir`, then import it. Cleans up
// the source's *previous* artifact first, so at most one stale copy per source lingers —
// the one the just-issued import still holds open. (The final artifact of a dev session is
// left on disk; it lives under a gitignored build dir, so this is harmless.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importUnique(sourcePath: string, dir: string, ext: string, write: (dest: string) => Promise<unknown>): Promise<any> {
  mkdirSync(dir, { recursive: true });
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const unique = path.join(dir, `${base}.hmr-${++epoch}${ext}`);
  await write(unique);
  const prev = lastArtifact.get(sourcePath);
  if (prev) {
    try {
      await Bun.file(prev).delete();
    } catch {
      /* ignore */
    }
  }
  lastArtifact.set(sourcePath, unique);
  return import(Bun.pathToFileURL(unique).href);
}

// Re-import a freshly built module by copying it to a unique sibling path. The copy lives
// beside the original so its relative chunk imports still resolve to the (content-stable,
// hashed) shared chunks emitted alongside it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freshImport(filePath: string): Promise<any> {
  return importUnique(filePath, path.dirname(filePath), path.extname(filePath), (dest) => Bun.write(dest, Bun.file(filePath)));
}

// Re-import a source file that lives *outside* the build dir (e.g. `svelte.config.js` in
// the project root). A plain copy into `tempDir` would break the file's relative imports,
// so bundle it first: Bun.build inlines relative imports, while `packages: 'external'`
// leaves node_modules specifiers untouched (resolved from `tempDir` upward at import time).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freshImportBundled(filePath: string, tempDir: string): Promise<any> {
  return importUnique(filePath, tempDir, '.mjs', async (dest) => {
    const result = await Bun.build({
      entrypoints: [filePath],
      target: 'bun',
      format: 'esm',
      packages: 'external',
    });
    if (!result.success) {
      throw new AggregateError(result.logs, `Failed to bundle ${filePath}`);
    }
    await Bun.write(dest, await result.outputs[0]!.text());
  });
}
