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

    const { shaken } = await shakeApp(dir);

    // Keyed by absolute path, matching the compiler's onLoad args.path.
    const slimmed = shaken.get(child);
    expect(slimmed).toBeDefined();
    expect(slimmed).not.toContain('showBadge'); // folded — never varies
    expect(slimmed).not.toContain('{#if'); // dead branch removed
    expect(slimmed).not.toContain('.unused'); // CSS narrowed
    expect(slimmed).toContain('label'); // genuinely varying prop kept
  });

  test('returns an empty map for a directory with no .svelte files', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-app-empty-'));
    const { shaken } = await shakeApp(dir);
    expect(shaken.size).toBe(0);
  });
});
