/**
 * Bundle a web component entry into a minified browser script string for
 * inlining into the HTML shell as `<script>...</script>`. The path is
 * resolved relative to `src/`, so callers pass paths like
 * `./web-components/ServerIsland.ts`.
 */
import path from 'node:path';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { minifyBuildOutputs, resolveMinifierChoice, type MochiJsMinifier } from './jsMinifier';

// This file lives in `src/compiler/`, so climb one level: resolving `relPath`
// against `import.meta.url` would anchor callers' paths to `src/compiler/`.
const SRC_URL = new URL('../', import.meta.url);

/**
 * A classic `<script>` cannot run `import`/`export`, so anything module-shaped reaching an inline script would be a
 * `SyntaxError` on every page load — worth failing the build over.
 */
export function assertNoModuleSyntax(fileName: string, code: string): void {
  const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(code);
  const statics = imports.filter((i) => i.kind !== 'dynamic-import');
  if (statics.length > 0 || exports.length > 0) {
    throw new Error(
      `${fileName} is injected as a classic <script> but still contains module syntax ` +
        `(${statics.length} import(s), ${exports.length} export(s)) — it would be a SyntaxError in the browser.`,
    );
  }
}

export async function buildInlineWebComponent(relPath: string, minifier?: MochiJsMinifier): Promise<string> {
  const entry = Bun.fileURLToPath(new URL(relPath, SRC_URL));
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [serverOnlyModuleGuard],
    target: 'browser',
    // Classic scripts on one page share a single global lexical scope, so a bare top-level `class`/`let` would be a
    // `SyntaxError` against a same-named binding in any other classic script, including one in the user's shell.
    format: 'iife',
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
  // Script mode is the goal the browser actually parses this with: sloppy, `this` is `window` at top level.
  const reminified = await minifyBuildOutputs([output], resolveMinifierChoice(minifier), { module: false });
  const js = reminified?.get(output.path) ?? (await output.text());
  assertNoModuleSyntax(path.basename(entry), js);
  return js;
}
