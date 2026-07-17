import { describe, expect, test } from 'bun:test';
import { compile } from 'svelte/compiler';
import { injectHydratableContextSeed } from './svelteAstPreprocess';

const FILE = '/virtual/Test.svelte';

/** The seeded source must stay compilable — string assertions alone can pass on broken output. */
function compiles(source: string): void {
  compile(source, { generate: 'server', filename: FILE });
  compile(source, { generate: 'client', filename: FILE });
}

describe('injectHydratableContextSeed', () => {
  test('runes destructure without isHydratable: prop grafted into the pattern, seed after the declaration', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { title } = $props();\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out).toContain(`import { setContext as __mochi_set_ctx__ } from 'svelte';`);
    expect(out).toContain('{ __mochi_hydratable: __mochi_ih__, title }');
    expect(out).toContain(`if (__mochi_ih__ === true) __mochi_set_ctx__(Symbol.for('mochi:hydratable'), true);`);
    compiles(out);
  });

  test('destructure with rest: graft lands before the rest element and rest survives', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { a, ...rest } = $props();\n</script>\n<div {...rest}>{a}</div>`, FILE);
    expect(out).toContain('{ __mochi_hydratable: __mochi_ih__, a, ...rest }');
    compiles(out);
  });

  test('existing transport-prop binding (renamed, with default) is reused, no new binding added', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { __mochi_hydratable: hydratable = false } = $props();\n</script>\n<p>{hydratable}</p>`, FILE);
    expect(out).not.toContain('__mochi_ih__');
    expect(out).toContain('if (hydratable === true) __mochi_set_ctx__');
    compiles(out);
  });

  test('a user prop named isHydratable is left alone — no longer a framework name', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { isHydratable } = $props();\n</script>\n<p>{isHydratable}</p>`, FILE);
    expect(out).toContain('{ __mochi_hydratable: __mochi_ih__, isHydratable }');
    expect(out).toContain('if (__mochi_ih__ === true) __mochi_set_ctx__');
    compiles(out);
  });

  test('identifier pattern (const props = $props()) reads off the object, pattern untouched', () => {
    const out = injectHydratableContextSeed(`<script>\n  const props = $props();\n</script>\n<p>{props.x}</p>`, FILE);
    expect(out).toContain('if (props.__mochi_hydratable === true) __mochi_set_ctx__');
    expect(out).not.toContain('__mochi_ih__');
    compiles(out);
  });

  test('TS-annotated destructure in lang="ts" scripts', () => {
    const out = injectHydratableContextSeed(`<script lang="ts">\n  let { title }: { title?: string } = $props();\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out).toContain('{ __mochi_hydratable: __mochi_ih__, title }');
    compiles(out);
  });

  test('legacy component (export let): seeds via $$props, never injects $props()', () => {
    const out = injectHydratableContextSeed(`<script>\n  export let title = '';\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out).toContain('if ($$props.__mochi_hydratable === true) __mochi_set_ctx__');
    expect(out).not.toContain('$props()');
    compiles(out);
  });

  test('legacy component ($: label): seeds via $$props', () => {
    const out = injectHydratableContextSeed(`<script>\n  let n = 1;\n  $: doubled = n * 2;\n</script>\n<p>{doubled}</p>`, FILE);
    expect(out).toContain('if ($$props.__mochi_hydratable === true) __mochi_set_ctx__');
    expect(out).not.toContain('$props()');
    compiles(out);
  });

  test('mode-neutral script (imports + const only): full $props() prologue injected', () => {
    const out = injectHydratableContextSeed(`<script>\n  const items = [1, 2, 3];\n</script>\n<p>{items.length}</p>`, FILE);
    expect(out).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out);
  });

  test('rune usage without $props() ($state): prologue injected', () => {
    const out = injectHydratableContextSeed(`<script>\n  let count = $state(0);\n</script>\n<button onclick={() => count++}>{count}</button>`, FILE);
    expect(out).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out);
  });

  test('no script at all: a script with the prologue is prepended', () => {
    const out = injectHydratableContextSeed(`<p>static</p>`, FILE);
    expect(out).toContain('<script>');
    expect(out).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out);
  });

  test('mode-ambiguous script (bare reactive let): left untouched', () => {
    const source = `<script>\n  let count = 0;\n</script>\n<button on:click={() => count++}>{count}</button>`;
    expect(injectHydratableContextSeed(source, FILE)).toBe(source);
  });

  test('event modifiers force the legacy path even with a bare script', () => {
    const out = injectHydratableContextSeed(`<script>\n  const go = () => {};\n</script>\n<a href="/x" on:click|preventDefault={go}>x</a>`, FILE);
    expect(out).toContain('$$props.__mochi_hydratable');
    expect(out).not.toContain('$props()');
    compiles(out);
  });

  test('runes: false forces the $$props path regardless of script shape', () => {
    const out = injectHydratableContextSeed(`<script>\n  const items = [];\n</script>\n<p>{items.length}</p>`, FILE, false);
    expect(out).toContain('$$props.__mochi_hydratable');
    expect(out).not.toContain('$props()');
  });

  test('runes: true forces the $props() path for an otherwise-ambiguous script', () => {
    const out = injectHydratableContextSeed(`<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE, true);
    expect(out).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out);
  });

  test('idempotent: seeded output passes through unchanged', () => {
    const once = injectHydratableContextSeed(`<script>\n  let { a } = $props();\n</script>\n<p>{a}</p>`, FILE);
    expect(injectHydratableContextSeed(once, FILE)).toBe(once);
  });

  test('unparseable source is returned unchanged for svelte.compile to diagnose', () => {
    const source = `<script>\n  let {{ = $props();\n</script>`;
    expect(injectHydratableContextSeed(source, FILE)).toBe(source);
  });
});
