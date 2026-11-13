/** Helpers for `classicScriptScope*.test.ts`, which inspect the inline classic scripts Mochi injects into a page. */
import { parseSync } from 'oxc-parser';

/** Every `<script>` on the page the browser runs as a classic script — i.e. not `type="module"` and not `src`. */
export function classicScripts(page: string): string[] {
  const out: string[] = [];
  for (const match of page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1]!;
    if (/type=/.test(attrs) || /\bsrc=/.test(attrs)) {
      continue;
    }
    out.push(match[2]!);
  }
  return out;
}

/**
 * Names a script contributes to the shared global scope. `let`/`const`/`class` land in the global *lexical*
 * environment, where a redeclaration by any other script on the page is a hard SyntaxError; `var`/`function` land on
 * the global object and merely shadow, so they are reported too but are the milder case.
 */
export function topLevelDeclarations(code: string): string[] {
  const { program } = parseSync('inline.js', code, { sourceType: 'script' });
  const names: string[] = [];
  for (const node of program.body as { type: string; id?: { name?: string }; declarations?: { id?: { name?: string } }[] }[]) {
    if (node.type === 'VariableDeclaration') {
      names.push(...(node.declarations ?? []).map((d) => d.id?.name ?? '<pattern>'));
    } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      names.push(node.id?.name ?? '<anonymous>');
    }
  }
  return names;
}

/** Static import/export syntax, which a classic script cannot run at all. A dynamic `import()` is fine. */
export function moduleSyntax(code: string): { imports: string[]; exports: string[] } {
  const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(code);
  return { imports: imports.filter((i) => i.kind !== 'dynamic-import').map((i) => i.path), exports: [...exports] };
}
