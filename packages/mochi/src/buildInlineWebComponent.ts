/**
 * Bundle a web component entry into a minified browser script string for
 * inlining into the HTML shell as `<script>...</script>`. The path is
 * resolved relative to this file, so callers pass paths like
 * `./web-components/ServerIsland.ts`.
 */
// The bundled+minified output of a framework web component depends solely on
// its (constant) source file, so the result is stable for the life of the
// process. Memoize by `relPath` to avoid re-running a full Bun.build+minify on
// every Mochi.serve() call.
const cache = new Map<string, Promise<string>>();

export function buildInlineWebComponent(relPath: string): Promise<string> {
  let p = cache.get(relPath);
  if (!p) {
    p = buildInlineWebComponentUncached(relPath).catch((err) => {
      cache.delete(relPath);
      throw err;
    });
    cache.set(relPath, p);
  }
  return p;
}

async function buildInlineWebComponentUncached(relPath: string): Promise<string> {
  const entry = Bun.fileURLToPath(new URL(relPath, import.meta.url));
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    minify: true,
    throw: false,
  });
  if (!result.success) {
    const lines = result.logs
      .map((l) => {
        const p = (l as { position?: { file: string; line: number; column: number } | null }).position;
        const where = p ? `${p.file}:${p.line}:${p.column}` : '<unknown>';
        return `  ${where} — ${l.message}`;
      })
      .join('\n');
    throw new Error(`buildInlineWebComponent failed for ${entry}:\n${lines}`);
  }
  return result.outputs[0]!.text();
}
