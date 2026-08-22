import { describe, expect, it } from 'bun:test';
import { compile as svelteCompile, compileModule as svelteCompileModule, type CompileOptions } from 'svelte/compiler';
import { svelteCompilerBackend } from './index';

/**
 * Byte-parity gate: the whole premise of the backend swap is that rsvelte emits
 * what `svelte/compiler` emits. Production output must match exactly. Dev output
 * is allowed to differ *only* in the dev-instrumentation cases pinned below — a
 * new divergence must fail here and be documented in the README before shipping.
 */

const CASES: Record<string, string> = {
  simple: `<script>let count = $state(0);</script>\n<button onclick={() => count++}>{count}</button>\n<style>button { color: red; }</style>\n`,
  snippet: `{#snippet row(i)}<li>{i}</li>{/snippet}\n<ul>{@render row(1)}</ul>\n`,
  each: `<script>let a = $state([1, 2]);</script>{#each a as x (x)}<p>{x}</p>{/each}`,
  bind: `<script>let v = $state('');</script><input bind:value={v} />`,
  props: `<script>let { a, b = 2 } = $props();</script><p>{a}{b}</p>`,
  store: `<script>import { writable } from 'svelte/store'; const s = writable(1);</script><p>{$s}</p>`,
  effect: `<script>let n = $state(0); $effect(() => { console.log(n); });</script><p>{n}</p>`,
  children: `<script>let { children } = $props();</script>{@render children?.()}`,
  html: `<script>let h = $state('<b>x</b>');</script>{@html h}`,
  awaitDerived: `<script>const p = $derived(await Promise.resolve(1));</script><p>{p}</p>`,
  transition: `<script>import { fade } from 'svelte/transition'; let s = $state(true);</script>{#if s}<p transition:fade>x</p>{/if}`,
  keyBlock: `<script>let k = $state(0);</script>{#key k}<p>{k}</p>{/key}`,
  awaitBlock: `<script>let p = $state(Promise.resolve(1));</script>{#await p then v}<p>{v}</p>{/await}`,
  classDirective: `<script>let on = $state(true);</script><div class:on>x</div><style>.on { color: red; }</style>`,
  spread: `<script>let props = $state({});</script><div {...props}>x</div>`,
};

/**
 * The only *tolerated* dev-mode divergences, as `${case}/${target}`. Each is
 * Svelte dev-only instrumentation rsvelte doesn't reproduce; none affects
 * runtime behaviour beyond a missing (or differently-placed) dev warning.
 * Production output for these same cases is asserted byte-identical below.
 *
 * Membership relaxes the equality assertion — it does not require a difference.
 * An rsvelte upgrade that fixes one of these logs a note instead of failing.
 */
const DEV_DIVERGENCES = new Set(['snippet/server', 'effect/client', 'awaitDerived/client']);

// Mirrors FRAMEWORK_COMPILER_DEFAULTS + FRAMEWORK_FORCED_COMPILER_OPTIONS in mochi's
// svelteConfig.ts, so parity is asserted under the options Mochi actually compiles with.
function opts(generate: 'server' | 'client', filename: string, dev: boolean): CompileOptions {
  return { generate, filename, dev, experimental: { async: true }, discloseVersion: false };
}

describe('svelteCompilerBackend', () => {
  it('identifies itself', () => {
    expect(svelteCompilerBackend.name).toBe('rsvelte');
    // Both halves matter: the rsvelte release and the Svelte version it targets
    // move independently, and the compile-cache fingerprint has to see either.
    expect(svelteCompilerBackend.version).toMatch(/^\d+\.\d+\.\d+.*\+svelte\d+\.\d+\.\d+/);
  });

  for (const [name, source] of Object.entries(CASES)) {
    for (const generate of ['server', 'client'] as const) {
      it(`compile() is byte-identical to svelte/compiler — ${name}/${generate}`, () => {
        const o = opts(generate, `${name}.svelte`, false);
        const expected = svelteCompile(source, o);
        const actual = svelteCompilerBackend.compile(source, o);
        expect(actual.js.code).toBe(expected.js.code);
        expect(actual.css?.code ?? null).toBe(expected.css?.code ?? null);
      });

      const key = `${name}/${generate}`;
      it(`compile() dev output ${DEV_DIVERGENCES.has(key) ? 'may diverge as documented' : 'is byte-identical'} — ${key}`, () => {
        const o = opts(generate, `${name}.svelte`, true);
        const expected = svelteCompile(source, o).js.code;
        const actual = svelteCompilerBackend.compile(source, o).js.code;
        if (!DEV_DIVERGENCES.has(key)) {
          expect(actual).toBe(expected);
          return;
        }
        // A one-way allowance: an rsvelte release that closes the gap must not
        // turn CI red, so converging is only reported, never asserted.
        if (actual === expected) {
          console.warn(`[mochi-rsvelte] dev output for ${key} now matches svelte/compiler — drop it from DEV_DIVERGENCES and from the docs' "Known divergences".`);
        }
      });
    }
  }

  it('compileModule() matches modulo the header comment and printer whitespace', () => {
    const source = `export const x = $state(1);\nexport function inc() { x; }\n`;
    const normalize = (code: string) =>
      code
        .replace(/^\/\*.*?\*\/\n/, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const generate of ['server', 'client'] as const) {
      const o = opts(generate, 'store.svelte.js', false);
      expect(normalize(svelteCompilerBackend.compileModule(source, o).js.code)).toBe(normalize(svelteCompileModule(source, o).js.code));
    }
  });

  it('strips function-valued options that cannot cross the native boundary', () => {
    const o = { ...opts('server', 'Hashed.svelte', false), cssHash: () => 'custom-hash', warningFilter: () => true } as CompileOptions;
    const result = svelteCompilerBackend.compile(CASES.simple!, o);
    expect(result.js.code).toBe(svelteCompile(CASES.simple!, opts('server', 'Hashed.svelte', false)).js.code);
  });

  it('does not mutate the callers options object', () => {
    const cssHash = () => 'custom-hash';
    const o = { ...opts('server', 'Hashed.svelte', false), cssHash } as CompileOptions & { cssHash?: unknown };
    svelteCompilerBackend.compile(CASES.simple!, o);
    expect(o.cssHash).toBe(cssHash);
  });
});
