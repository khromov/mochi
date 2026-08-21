/**
 * Bundle a web component entry into a minified browser script string for
 * inlining into the HTML shell as `<script>...</script>`. The path is
 * resolved relative to `src/`, so callers pass paths like
 * `./web-components/ServerIsland.ts`.
 */
import { CLIENT_BUILD_DEFINE, clientBuildFeatures, serverOnlyModuleGuard } from './serverOnlyModuleGuard';

// This file lives in `src/compiler/`, so climb one level: resolving `relPath`
// against `import.meta.url` would anchor callers' paths to `src/compiler/`.
const SRC_URL = new URL('../', import.meta.url);

export async function buildInlineWebComponent(relPath: string, { debug = false }: { debug?: boolean } = {}): Promise<string> {
  const entry = Bun.fileURLToPath(new URL(relPath, SRC_URL));
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [serverOnlyModuleGuard],
    target: 'browser',
    define: { ...CLIENT_BUILD_DEFINE },
    features: clientBuildFeatures(debug),
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
