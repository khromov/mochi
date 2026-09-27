/**
 * Bundle a web component entry into a minified browser script string for
 * inlining into the HTML shell as `<script>...</script>`. The path is
 * resolved relative to `src/`, so callers pass paths like
 * `./web-components/ServerIsland.ts`.
 */
import path from 'node:path';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { assertNoModuleSyntax, minifyBuildOutputs, resolveMinifierChoice, type MochiJsMinifier } from './jsMinifier';

// This file lives in `src/compiler/`, so climb one level: resolving `relPath`
// against `import.meta.url` would anchor callers' paths to `src/compiler/`.
const SRC_URL = new URL('../', import.meta.url);

export async function buildInlineWebComponent(relPath: string, minifier?: MochiJsMinifier): Promise<string> {
  const entry = Bun.fileURLToPath(new URL(relPath, SRC_URL));
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [serverOnlyModuleGuard],
    target: 'browser',
    define: { ...CLIENT_BUILD_DEFINE },
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
  const output = result.outputs[0]!;
  // `module: false` because the caller injects this into a plain `<script>`: top-level bindings are real globals there,
  // so they must not be renamed into collision-prone one-letter names or dropped as unobservable.
  const reminified = await minifyBuildOutputs([output], resolveMinifierChoice(minifier), { module: false });
  const js = reminified?.get(output.path) ?? (await output.text());
  // Checked for both minifiers, at the point where the bundle becomes a classic script: `Bun.build` defaults to the
  // esm format, so an entry that ever stopped being self-contained would emit an `import` no `<script>` can run.
  assertNoModuleSyntax(path.basename(entry), js);
  return js;
}
