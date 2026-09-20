import type { AST } from 'svelte/compiler';
import type MagicString from 'magic-string';
import { walk } from 'zimmerframe';
import { encodeSourcePath } from './manifestPaths';
import type { SvelteCompileOutput } from './svelteCompilerBackend';

// At-rules whose nested rules Svelte still scopes; every other at-rule (`@font-face`, `@import`, `@property`, a bare
// `@layer` statement, …) is emitted unscoped and so can affect the page without its component rendering.
const SCOPED_ATRULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style', 'keyframes']);

/**
 * True when the stylesheet has `:global` or unscoped at-rules, the two page-wide cases Svelte's own `css.hasGlobal` does
 * not reliably report: it skips a `:global` block holding only nested rules and every at-rule but `-global-` keyframes.
 */
export function hasGlobalCss(css: AST.CSS.StyleSheet): boolean {
  let global = false;
  walk(css as AST.CSS.Node, null, {
    _(node, { next }) {
      if (global) {
        return;
      }
      if (node.type === 'PseudoClassSelector' && node.name === 'global') {
        global = true;
        return;
      }
      if (node.type === 'Atrule') {
        const name = node.name.toLowerCase();
        if (!SCOPED_ATRULES.has(name) || (name === 'keyframes' && node.prelude.trim().startsWith('-global-')) || (name === 'layer' && node.block === null)) {
          global = true;
          return;
        }
      }
      next();
    },
  });
  return global;
}

/**
 * Prepend the `markRenderedCss` call to the instance script of a component whose stylesheet passes `hasGlobalCss`,
 * returning whether it did. `isCssTracked` makes the final prunability call once the compiler has reported `hasGlobal`.
 */
export function instrumentCssTracking(ast: AST.Root, s: MagicString, filePath: string): boolean {
  if (!ast.css || hasGlobalCss(ast.css)) {
    return false;
  }
  const prologue = `\nimport { markRenderedCss as __mochi_css__ } from "mochi-framework";\n__mochi_css__(${JSON.stringify(encodeSourcePath(filePath))});`;
  if (ast.instance) {
    s.appendRight((ast.instance.content as unknown as { start: number }).start, prologue);
  } else {
    s.prepend(`<script>${prologue}\n</script>\n`);
  }
  return true;
}

/**
 * Whether a marked component's stylesheet is linked only when it rendered. Svelte's `css.hasGlobal` applies its exact
 * scoping rules (`:root` without `:has`, `:host`, `::view-transition*`, `-global-` keyframes), so they are not mirrored
 * here; a backend that does not report it keeps the always-linked behaviour.
 */
export function isCssTracked(cssMarked: boolean, css: SvelteCompileOutput['css']): boolean {
  return cssMarked && css?.hasGlobal === false;
}
