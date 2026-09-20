import type { AST } from 'svelte/compiler';
import type MagicString from 'magic-string';
import { walk } from 'zimmerframe';
import { encodeSourcePath } from './manifestPaths';

// At-rules whose nested rules Svelte still scopes; every other at-rule (`@font-face`, `@import`, `@property`, a bare
// `@layer` statement, …) is emitted unscoped and so can affect the page without its component rendering.
const SCOPED_ATRULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style', 'keyframes']);
const GLOBAL_PSEUDO_ELEMENTS = new Set(['view-transition', 'view-transition-group', 'view-transition-old', 'view-transition-new', 'view-transition-image-pair']);

// Mirrors Svelte's `is_global_like`: `:root` without `:has`, or an all-pseudo compound led by `:host` or a
// `::view-transition*` pseudo-element, is left unscoped.
function isGlobalLike(rel: AST.CSS.RelativeSelector): boolean {
  const has = (name: string) => rel.selectors.some((s) => s.type === 'PseudoClassSelector' && s.name === name);
  if (has('root') && !has('has')) {
    return true;
  }
  const first = rel.selectors[0];
  if (first === undefined || !rel.selectors.every((s) => s.type === 'PseudoClassSelector' || s.type === 'PseudoElementSelector')) {
    return false;
  }
  return (first.type === 'PseudoClassSelector' && first.name === 'host') || (first.type === 'PseudoElementSelector' && GLOBAL_PSEUDO_ELEMENTS.has(first.name));
}

/** True when the stylesheet has rules that apply regardless of whether the component renders. */
export function hasGlobalCss(css: AST.CSS.StyleSheet): boolean {
  let global = false;
  walk(css as AST.CSS.Node, null, {
    _(node, { next, path }) {
      if (global) {
        return;
      }
      if (node.type === 'PseudoClassSelector' && node.name === 'global') {
        global = true;
        return;
      }
      // Svelte scopes a selector unless every relative selector is global-like, so `:root[data-theme] .a` stays prunable.
      if (node.type === 'ComplexSelector' && path.at(-2)?.type === 'Rule' && node.children.every(isGlobalLike)) {
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
 * Prepend the `markRenderedCss` call to the instance script of a component whose scoped CSS can only ever match its own
 * markup, returning whether it did. Global styles stay untracked so they keep the always-linked behaviour.
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
