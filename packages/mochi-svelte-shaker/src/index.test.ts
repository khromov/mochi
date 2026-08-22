import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { svelteShakerBackend } from './index';

const shakeApp = svelteShakerBackend.shakeApp;

describe('svelteShakerBackend', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('identifies itself with the resolved engine version', () => {
    expect(svelteShakerBackend.name).toBe('svelte-shaker');
    expect(svelteShakerBackend.version).toMatch(/^\d+\.\d+\.\d+/);
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

    const { shaken } = await shakeApp(dir);

    // Keyed by absolute path, matching the compiler's onLoad args.path.
    const slimmed = shaken.get(child);
    expect(slimmed).toBeDefined();
    expect(slimmed).not.toContain('showBadge'); // folded — never varies
    expect(slimmed).not.toContain('{#if'); // dead branch removed
    expect(slimmed).not.toContain('.unused'); // CSS narrowed
    expect(slimmed).toContain('label'); // genuinely varying prop kept
  });

  // A stripped directive is invisible downstream: the shaken source feeds the mochi preprocessor, which
  // early-returns when no `mochi:` directive remains, so the island silently degrades to a plain component.
  // svelte-shaker < 0.18.1 dropped them; this fails loudly if that ever regresses.
  test('preserves mochi: directives on call sites', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-app-directives-'));
    const child = path.join(dir, 'Child.svelte');
    writeFileSync(
      child,
      `<script>let { showBadge = false, label } = $props();</script>
{#if showBadge}<span class="badge">★</span>{/if}
<strong>{label}</strong>`,
    );
    const parent = path.join(dir, 'Parent.svelte');
    writeFileSync(
      parent,
      `<script>import Child from './Child.svelte';</script>
<Child mochi:hydrate label="hello" />
<Child mochi:defer:visible label="world" />`,
    );

    const { shaken } = await shakeApp(dir);

    // Folding through the island call sites proves the shake really ran — without it an engine that
    // returned every source verbatim would satisfy the directive assertions below.
    const slimmedChild = shaken.get(child);
    expect(slimmedChild).toBeDefined();
    expect(slimmedChild).not.toContain('showBadge');
    expect(slimmedChild).not.toContain('{#if');

    const slimmed = shaken.get(parent);
    expect(slimmed).toBeDefined();
    expect(slimmed).toContain('mochi:hydrate');
    expect(slimmed).toContain('mochi:defer:visible');
    // Regular attributes survive too — distinguishes a directive-only drop from an all-attribute drop.
    expect(slimmed).toContain('label="hello"');
    expect(slimmed).toContain('label="world"');
  });

  test('returns an empty map for a directory with no .svelte files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-app-empty-'));
    writeFileSync(path.join(dir, 'notes.ts'), 'export const x = 1;');
    const { shaken } = await shakeApp(dir);
    expect(shaken.size).toBe(0);
  });
});
