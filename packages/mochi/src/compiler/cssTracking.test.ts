import { describe, expect, test } from 'bun:test';
import { compile, parse } from 'svelte/compiler';
import { hasGlobalCss, isCssTracked } from './cssTracking';
import type { SvelteCompileOutput } from './svelteCompilerBackend';
import { preprocessHydratable } from './svelteAstPreprocess';
import { encodeSourcePath } from './manifestPaths';

const FILE = '/test/Styled.svelte';
const KEY = encodeSourcePath(FILE);
const MARK = `__mochi_css__(${JSON.stringify(KEY)});`;

function globalOf(style: string): boolean {
  const ast = parse(`<div class="a">x</div><style>${style}</style>`, { modern: true });
  return hasGlobalCss(ast.css!);
}

describe('hasGlobalCss', () => {
  test('scoped rules, including inside @media and @keyframes, are not global', () => {
    expect(globalOf('.a { color: red }')).toBe(false);
    expect(globalOf('@media (min-width: 1px) { .a { color: red } }')).toBe(false);
    expect(globalOf('@keyframes spin { to { rotate: 1turn } } .a { animation: spin 1s }')).toBe(false);
    expect(globalOf('@layer base { .a { color: red } }')).toBe(false);
  });

  test(':global selectors are global wherever they sit', () => {
    expect(globalOf(':global(body) { margin: 0 }')).toBe(true);
    expect(globalOf('.a :global(.b) { margin: 0 }')).toBe(true);
    expect(globalOf('.a { :global(.b) { margin: 0 } }')).toBe(true);
    expect(globalOf(':is(:global(.b)) { margin: 0 }')).toBe(true);
    expect(globalOf(':global { .b { margin: 0 } }')).toBe(true);
    expect(globalOf('@media print { :global(body) { margin: 0 } }')).toBe(true);
  });

  test('a :global block of nested rules is global even though Svelte reports hasGlobal: false for it', () => {
    const source = '<div class="a">x</div><style>:global { .b { margin: 0 } }</style>';
    expect(compile(source, { generate: 'server', filename: FILE }).css?.hasGlobal).toBe(false);
    expect(globalOf(':global { .b { margin: 0 } }')).toBe(true);
  });

  test('unscoped at-rules are global', () => {
    expect(globalOf('@keyframes -global-spin { to { rotate: 1turn } }')).toBe(true);
    expect(globalOf("@font-face { font-family: X; src: url('/x.woff2') }")).toBe(true);
    expect(globalOf("@import url('/x.css');")).toBe(true);
    expect(globalOf('@property --x { syntax: "*"; inherits: false }')).toBe(true);
    expect(globalOf('@layer reset, base;')).toBe(true);
  });
});

describe('isCssTracked', () => {
  function trackedOf(style: string): boolean {
    const { transformed, cssMarked } = preprocessHydratable(`<div class="a">x</div><style>${style}</style>`, FILE);
    return isCssTracked(cssMarked, compile(transformed, { generate: 'server', filename: FILE }).css);
  }

  test('rules Svelte leaves unscoped (:root, :host, ::view-transition*) keep the stylesheet always linked', () => {
    expect(trackedOf(':root { --brand: red }')).toBe(false);
    expect(trackedOf(':root:not(.x) { --brand: red }')).toBe(false);
    expect(trackedOf(':host { display: block }')).toBe(false);
    expect(trackedOf(':host(.x) { display: block }')).toBe(false);
    expect(trackedOf('::view-transition-old(root) { animation: none }')).toBe(false);
    expect(trackedOf('@layer base { :root { --brand: red } }')).toBe(false);
    expect(trackedOf(':global(body) { margin: 0 }')).toBe(false);
    expect(trackedOf("@font-face { font-family: X; src: url('/x.woff2') }")).toBe(false);
  });

  test('selectors Svelte still scopes despite a global-like part stay prunable', () => {
    expect(trackedOf('.a { color: red }')).toBe(true);
    expect(trackedOf(':root[data-theme=dark] .a { color: red }')).toBe(true);
    expect(trackedOf(':root:has(.x) .a { color: red }')).toBe(true);
    expect(trackedOf(':host .a { color: red }')).toBe(true);
    expect(trackedOf('.a:not(:root) { color: red }')).toBe(true);
  });

  test('a backend that does not report hasGlobal keeps the always-linked behaviour', () => {
    expect(isCssTracked(true, { code: '.a{}' } as unknown as SvelteCompileOutput['css'])).toBe(false);
    expect(isCssTracked(true, null)).toBe(false);
    expect(isCssTracked(false, { code: '', hasGlobal: false })).toBe(false);
  });
});

describe('instrumentCssTracking via preprocessHydratable', () => {
  test('a styled component gets the mark at the top of its instance script', () => {
    const { transformed, cssMarked } = preprocessHydratable(`<script>\nlet x = 1;\n</script>\n<p class="a">{x}</p>\n<style>.a { color: red }</style>`, FILE);
    expect(cssMarked).toBe(true);
    expect(transformed).toContain('import { markRenderedCss as __mochi_css__ } from "mochi-framework";');
    expect(transformed).toContain(MARK);
    expect(transformed.indexOf(MARK)).toBeLessThan(transformed.indexOf('let x = 1;'));
    expect(transformed).not.toContain('\\');
  });

  test('a component without an instance script gets one', () => {
    const { transformed, cssMarked } = preprocessHydratable(`<script module>\nexport const n = 1;\n</script>\n<p class="a">a</p>\n<style>.a { color: red }</style>`, FILE);
    expect(cssMarked).toBe(true);
    expect(transformed.startsWith('<script>')).toBe(true);
    expect(transformed).toContain('<script module>');
    expect(transformed).toContain(MARK);
  });

  test('a legacy-mode component is tracked too', () => {
    const { transformed, cssMarked } = preprocessHydratable(`<script>\nexport let n = 1;\n</script>\n<p class="a">{n}</p>\n<style>.a { color: red }</style>`, FILE);
    expect(cssMarked).toBe(true);
    expect(transformed).toContain(MARK);
  });

  test('global styles and style-less components stay untracked and untouched', () => {
    for (const source of [`<p>a</p>`, `<script>\nlet x = 1;\n</script>\n<p>{x}</p>`, `<p class="a">a</p>\n<style>:global(body) { margin: 0 }</style>`]) {
      const { transformed, cssMarked } = preprocessHydratable(source, FILE);
      expect(cssMarked).toBe(false);
      expect(transformed).toBe(source);
    }
  });

  test('tracking composes with island directives in the same file', () => {
    const source = `<script>\nimport Foo from './Foo.svelte';\n</script>\n<Foo mochi:hydrate />\n<style>:where(p) { color: red }</style>`;
    const { transformed, cssMarked, hydratables } = preprocessHydratable(source, FILE);
    expect(hydratables).toHaveLength(1);
    expect(cssMarked).toBe(true);
    expect(transformed).toContain('__mochi_emit_props__');
    expect(transformed).toContain(MARK);
  });
});
