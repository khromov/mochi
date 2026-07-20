import { describe, expect, test } from 'bun:test';
import { compile } from 'svelte/compiler';
import { injectHydratableContextSeed } from './svelteAstPreprocess';

const FILE = '/virtual/Test.svelte';

/** The seeded source must stay compilable — string assertions alone can pass on broken output. */
function compiles(source: string, runes?: boolean): void {
  compile(source, { generate: 'server', filename: FILE, ...(runes === undefined ? {} : { runes }) });
  compile(source, { generate: 'client', filename: FILE, ...(runes === undefined ? {} : { runes }) });
}

describe('injectHydratableContextSeed', () => {
  test('runes destructure without isHydratable: prop grafted into the pattern, seed after the declaration', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { title } = $props();\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out.declined).toBeNull();
    expect(out.code).toContain(`import { setContext as __mochi_set_ctx__ } from 'svelte';`);
    expect(out.code).toContain('{ __mochi_hydratable: __mochi_ih__, title }');
    expect(out.code).toContain(`if (__mochi_ih__ === true) __mochi_set_ctx__(Symbol.for('mochi:hydratable'), true);`);
    compiles(out.code);
  });

  test('destructure with rest: graft lands before the rest element and rest survives', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { a, ...rest } = $props();\n</script>\n<div {...rest}>{a}</div>`, FILE);
    expect(out.code).toContain('{ __mochi_hydratable: __mochi_ih__, a, ...rest }');
    compiles(out.code);
  });

  test('existing transport-prop binding (renamed, with default) is reused, no new binding added', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { __mochi_hydratable: hydratable = false } = $props();\n</script>\n<p>{hydratable}</p>`, FILE);
    expect(out.code).not.toContain('__mochi_ih__');
    expect(out.code).toContain('if (hydratable === true) __mochi_set_ctx__');
    compiles(out.code);
  });

  test("user's own setContext import coexists with the aliased seed import and does not trip the idempotency guard", () => {
    const out = injectHydratableContextSeed(
      `<script>\n  import { setContext } from 'svelte';\n  let { title } = $props();\n  setContext('user-key', 'user-value');\n</script>\n<h1>{title}</h1>`,
      FILE,
    );
    expect(out.declined).toBeNull();
    expect(out.code).toContain(`import { setContext as __mochi_set_ctx__ } from 'svelte';`);
    expect(out.code).toContain(`import { setContext } from 'svelte';`);
    expect(out.code).toContain(`if (__mochi_ih__ === true) __mochi_set_ctx__(Symbol.for('mochi:hydratable'), true);`);
    expect(out.code).toContain(`setContext('user-key', 'user-value');`);
    compiles(out.code);
  });

  test('a user prop named isHydratable is left alone — no longer a framework name', () => {
    const out = injectHydratableContextSeed(`<script>\n  let { isHydratable } = $props();\n</script>\n<p>{isHydratable}</p>`, FILE);
    expect(out.code).toContain('{ __mochi_hydratable: __mochi_ih__, isHydratable }');
    expect(out.code).toContain('if (__mochi_ih__ === true) __mochi_set_ctx__');
    compiles(out.code);
  });

  test('identifier pattern (const props = $props()) becomes a rest destructure so spreads cannot leak the transport prop', () => {
    const out = injectHydratableContextSeed(`<script>\n  const props = $props();\n</script>\n<p>{props.x}</p>`, FILE);
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__, ...props } = $props();');
    expect(out.code).toContain('if (__mochi_ih__ === true) __mochi_set_ctx__');
    compiles(out.code);
  });

  test('TS-annotated identifier pattern keeps its annotation outside the injected braces', () => {
    const out = injectHydratableContextSeed(`<script lang="ts">\n  const props: { x?: number } = $props();\n</script>\n<p>{props.x}</p>`, FILE);
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__, ...props }: { x?: number } = $props();');
    compiles(out.code);
  });

  test('TS-annotated destructure in lang="ts" scripts', () => {
    const out = injectHydratableContextSeed(`<script lang="ts">\n  let { title }: { title?: string } = $props();\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out.code).toContain('{ __mochi_hydratable: __mochi_ih__, title }');
    compiles(out.code);
  });

  test('legacy component (export let): declares the transport prop so it stays out of $$restProps', () => {
    const out = injectHydratableContextSeed(`<script>\n  export let title = '';\n</script>\n<h1>{title}</h1>`, FILE);
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    expect(out.code).toContain('if (__mochi_hydratable === true) __mochi_set_ctx__');
    expect(out.code).not.toContain('$props()');
    compiles(out.code);
  });

  test('legacy component ($: label): declared-prop seed, never $props()', () => {
    const out = injectHydratableContextSeed(`<script>\n  let n = 1;\n  $: doubled = n * 2;\n</script>\n<p>{doubled}</p>`, FILE);
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    expect(out.code).not.toContain('$props()');
    compiles(out.code);
  });

  test('legacy $$restProps spread compiles with the declared transport prop excluded from it', () => {
    const out = injectHydratableContextSeed(`<script>\n  export let label = '';\n</script>\n<span {...$$restProps}>{label}</span>`, FILE);
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    compiles(out.code);
  });

  test('mode-neutral script (imports + const only): full $props() prologue injected', () => {
    const out = injectHydratableContextSeed(`<script>\n  const items = [1, 2, 3];\n</script>\n<p>{items.length}</p>`, FILE);
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code);
  });

  test('imports + onMount call only (expression statement): mode-neutral, prologue injected', () => {
    const out = injectHydratableContextSeed(`<script>\n  import { onMount } from 'svelte';\n  onMount(() => {});\n</script>\n<p>static</p>`, FILE);
    expect(out.declined).toBeNull();
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code);
  });

  test('rune usage without $props() ($state): prologue injected', () => {
    const out = injectHydratableContextSeed(`<script>\n  let count = $state(0);\n</script>\n<button onclick={() => count++}>{count}</button>`, FILE);
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code);
  });

  test('no script at all: a script with the prologue is prepended', () => {
    const out = injectHydratableContextSeed(`<p>static</p>`, FILE);
    expect(out.code).toContain('<script>');
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code);
  });

  test('mode-ambiguous script (bare reactive let): left untouched, decline names the binding and the fixes', () => {
    const source = `<script>\n  let count = 0;\n</script>\n<button onclick={() => count++}>{count}</button>`;
    const out = injectHydratableContextSeed(source, FILE);
    expect(out.code).toBe(source);
    expect(out.declined).toContain('ambiguous');
    expect(out.declined).toContain('`let count`');
    expect(out.declined).toContain('let count = $state(…)');
    expect(out.declined).toContain('<svelte:options runes />');
  });

  // Svelte accepts the bare attribute and the explicit `={true}` form
  // interchangeably, and they reach the AST as different value shapes
  // (`true` vs an ExpressionTag), so both spellings are pinned here.
  test.each([
    ['bare', '<svelte:options runes />'],
    ['explicit true', '<svelte:options runes={true} />'],
    ['alongside another option', '<svelte:options runes namespace="html" />'],
  ])('%s <svelte:options runes> resolves an otherwise-ambiguous script via the $props() path', (_label, options) => {
    const out = injectHydratableContextSeed(`${options}\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE);
    expect(out.declined).toBeNull();
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code);
  });

  test('<svelte:options runes={false} /> resolves an otherwise-ambiguous script via the legacy path', () => {
    const out = injectHydratableContextSeed(`<svelte:options runes={false} />\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE);
    expect(out.declined).toBeNull();
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    expect(out.code).not.toContain('$props()');
    compiles(out.code);
  });

  test('a per-file <svelte:options runes> beats the project-wide compilerOptions.runes, both directions', () => {
    const overridesFalse = injectHydratableContextSeed(`<svelte:options runes />\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE, false);
    expect(overridesFalse.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(overridesFalse.code);

    const overridesTrue = injectHydratableContextSeed(`<svelte:options runes={false} />\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE, true);
    expect(overridesTrue.code).toContain('export let __mochi_hydratable = undefined;');
    compiles(overridesTrue.code);

    const explicitTrue = injectHydratableContextSeed(`<svelte:options runes={true} />\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE, false);
    expect(explicitTrue.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(explicitTrue.code);
  });

  test('a <svelte:options> without a runes attribute leaves the project-wide setting in charge', () => {
    const source = `<svelte:options namespace="html" />\n<script>\n  let count = 0;\n</script>\n<p>{count}</p>`;
    expect(injectHydratableContextSeed(source, FILE).declined).toContain('ambiguous');
    expect(injectHydratableContextSeed(source, FILE, true).code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
  });

  test('an ambiguous script whose first offender is not a `let` blames the statement, not a binding', () => {
    // `export const` is neither mode-neutral nor a legacy marker, and the later
    // `let` must not be named as the culprit — the scan stops at the first reject.
    const source = `<script>\n  export const meta = 'x';\n  let count = 0;\n</script>\n<p>{count}</p>`;
    const out = injectHydratableContextSeed(source, FILE);
    expect(out.code).toBe(source);
    expect(out.declined).toContain('a mode-sensitive top-level statement');
    expect(out.declined).not.toContain('`let count`');
    expect(out.declined).toContain('<svelte:options runes />');
  });

  test('an unsupported $props() pattern declines with a concrete alternative', () => {
    const source = `<script>\n  const [first] = $props();\n</script>\n<p>{first}</p>`;
    const out = injectHydratableContextSeed(source, FILE);
    expect(out.code).toBe(source);
    expect(out.declined).toContain('binding pattern');
    expect(out.declined).toContain('let props = $props()');
  });

  test('event modifiers force the legacy path even with a bare script', () => {
    const out = injectHydratableContextSeed(`<script>\n  const go = () => {};\n</script>\n<a href="/x" on:click|preventDefault={go}>x</a>`, FILE);
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    expect(out.code).not.toContain('$props()');
    compiles(out.code);
  });

  test('runes: false forces the legacy path regardless of script shape', () => {
    const out = injectHydratableContextSeed(`<script>\n  const items = [];\n</script>\n<p>{items.length}</p>`, FILE, false);
    expect(out.code).toContain('export let __mochi_hydratable = undefined;');
    expect(out.code).not.toContain('$props()');
    compiles(out.code, false);
  });

  test('runes: true forces the $props() path for an otherwise-ambiguous script', () => {
    const out = injectHydratableContextSeed(`<script>\n  let count = 0;\n</script>\n<p>{count}</p>`, FILE, true);
    expect(out.code).toContain('const { __mochi_hydratable: __mochi_ih__ } = $props();');
    compiles(out.code, true);
  });

  test('idempotent: seeded output passes through unchanged', () => {
    const once = injectHydratableContextSeed(`<script>\n  let { a } = $props();\n</script>\n<p>{a}</p>`, FILE);
    const twice = injectHydratableContextSeed(once.code, FILE);
    expect(twice.code).toBe(once.code);
    expect(twice.declined).toBeNull();
  });

  test('unparseable source is returned unchanged for svelte.compile to diagnose, without a decline', () => {
    const source = `<script>\n  let {{ = $props();\n</script>`;
    const out = injectHydratableContextSeed(source, FILE);
    expect(out.code).toBe(source);
    expect(out.declined).toBeNull();
  });
});
