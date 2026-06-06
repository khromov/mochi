import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { shakeApp } from './svelteShaker';

describe('shakeApp', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('folds a never-varying prop, drops its dead branch and unused CSS', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-app-'));
    const child = path.join(dir, 'Child.svelte');
    writeFileSync(
      child,
      `<script>let { showBadge = false, label } = $props();</script>
{#if showBadge}<span class="badge">★</span>{/if}
<strong>{label}</strong>
<style>.badge { color: gold; } .unused { color: red; }</style>`,
    );
    // Both call sites omit `showBadge`, so it always resolves to its default.
    writeFileSync(
      path.join(dir, 'Parent.svelte'),
      `<script>import Child from './Child.svelte';</script>
<Child label="hello" />
<Child label="world" />`,
    );

    const { sources, variants } = await shakeApp(dir);

    // Keyed by absolute path, matching the compiler's onLoad args.path.
    const slimmed = sources.get(child);
    expect(slimmed).toBeDefined();
    expect(slimmed).not.toContain('showBadge'); // folded — never varies
    expect(slimmed).not.toContain('{#if'); // dead branch removed
    expect(slimmed).not.toContain('.unused'); // CSS narrowed
    expect(slimmed).toContain('label'); // genuinely varying prop kept
    expect(variants.size).toBe(0); // no L2 without mono
  });

  test('returns empty maps for a directory with no .svelte files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-app-empty-'));
    const { sources, variants } = await shakeApp(dir);
    expect(sources.size).toBe(0);
    expect(variants.size).toBe(0);
  });

  // The canonical L2 case: `{#if a===1 && b===1}<Heavy/>` survives L1 narrowing
  // (a, b narrowed independently), but per-call-site specialization folds the
  // guard to false at every live site, so Heavy becomes unreferenced.
  function writeMonoFixture(root: string): { child: string; a: string } {
    const child = path.join(root, 'Child.svelte');
    writeFileSync(
      child,
      `<script>import Heavy from './Heavy.svelte'; let { a = 0, b = 0 } = $props();</script>
{#if a === 1 && b === 1}<Heavy/>{/if}
<p>base</p>`,
    );
    writeFileSync(path.join(root, 'Heavy.svelte'), `<p>HEAVY_MARKER</p>`);
    const a = path.join(root, 'A.svelte');
    writeFileSync(a, `<script>import Child from './Child.svelte';</script><Child a={0} b={1} />`);
    writeFileSync(path.join(root, 'B.svelte'), `<script>import Child from './Child.svelte';</script><Child a={1} b={0} />`);
    writeFileSync(path.join(root, 'Root.svelte'), `<script>import A from './A.svelte'; import B from './B.svelte';</script><A/><B/>`);
    return { child, a };
  }

  test('L2 specializes a child so its heavy branch folds out at every call site', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-mono-'));
    const { a } = writeMonoFixture(dir);

    const { variants, bindings, sources } = await shakeApp(dir, { mono: {} });

    expect(variants.size).toBeGreaterThan(0); // a variant was generated
    expect(bindings.length).toBeGreaterThan(0);
    // The owner now imports a variant instead of the base child.
    expect(sources.get(a)).toContain('shaker_v');
    // No generated variant keeps the `<Heavy/>` usage (only a now-dead import).
    for (const code of variants.values()) {
      expect(code).not.toContain('<Heavy');
    }
  });

  test('mono off produces no variants', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-nomono-'));
    writeMonoFixture(dir);
    const { variants } = await shakeApp(dir);
    expect(variants.size).toBe(0);
  });
});
