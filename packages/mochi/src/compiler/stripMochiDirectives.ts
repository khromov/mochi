import { parse } from 'svelte/compiler';
import type { AST } from 'svelte/compiler';
import MagicString from 'magic-string';
import { walk } from 'zimmerframe';

const DIRECTIVE_PREFIXES = ['mochi:hydrate', 'mochi:defer', 'mochi:clientOnly'];

/**
 * Removes every `mochi:*` island directive from a component's source. Standalone builds have no SSR pass to rewrite
 * directives into island wrappers — everything mounts client-side anyway — so a shared component's directives must be
 * dropped before the client compile, or Svelte would pass them through as junk props.
 */
export function stripMochiDirectives(source: string): string {
  if (!DIRECTIVE_PREFIXES.some((p) => source.includes(p))) {
    return source;
  }
  const ast = parse(source, { modern: true });
  const s = new MagicString(source);
  walk(ast.fragment as AST.SvelteNode, null, {
    Component(comp, { next }) {
      for (const attr of comp.attributes) {
        if (attr.type === 'Attribute' && DIRECTIVE_PREFIXES.some((p) => attr.name === p || attr.name === `${p}:visible`)) {
          s.remove(attr.start, attr.end);
        }
      }
      next();
    },
  });
  return s.toString();
}
