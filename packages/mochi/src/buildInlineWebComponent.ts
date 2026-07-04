/**
 * Bundle a web component entry into a minified browser script string for
 * inlining into the HTML shell as `<script>...</script>`. The path is
 * resolved relative to this file, so callers pass paths like
 * `./web-components/ServerIsland.ts`.
 */
export async function buildInlineWebComponent(relPath: string): Promise<string> {
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
