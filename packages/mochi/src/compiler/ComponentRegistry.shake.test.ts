import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MochiSvelteShakerOptions } from '../types';
import { logger } from '../utils/log';

// The engine now lives in the optional `@mochi-framework/svelte-shaker` add-on, which owns its own real-engine tests.
// What's under test here is the framework's plumbing around it — gating, exclude globs, the cache, the size report — so
// a deterministic stub is a better fixture than the engine, whose exact output can shift on a floor-range bump.
// Per-file process isolation keeps this module mock from leaking into other tests.
mock.module('./svelteShaker', () => ({
  resolveSvelteShaker: async () => ({
    name: 'stub-shaker',
    version: '0.0.0-test',
    shakeApp: (appRoot: string) => {
      const shaken = new Map<string, string>();
      const originals = new Map<string, string>();
      for (const name of readdirSync(appRoot)) {
        if (!name.endsWith('.svelte')) {
          continue;
        }
        const abs = path.join(appRoot, name);
        const source = readFileSync(abs, 'utf8');
        originals.set(abs, source);
        // Only Child is slimmed; Parent comes back verbatim — mirroring a real whole-app scan, which returns every
        // in-scope component but changes only some of them.
        shaken.set(abs, name === 'Child.svelte' ? source.replace(/showBadge/g, 'x').replace('.unused { color: red; }', '') : source);
      }
      return Promise.resolve({ shaken, originals });
    },
  }),
}));

const { ComponentRegistry } = await import('./ComponentRegistry');

/** Read the registry's private slimmed-source cache for assertions. */
function shakenSources(registry: InstanceType<typeof ComponentRegistry>): Map<string, string> {
  return (registry as unknown as { shakenSources: Map<string, string> }).shakenSources;
}

function makeRegistry(opt: boolean | MochiSvelteShakerOptions): InstanceType<typeof ComponentRegistry> {
  return new ComponentRegistry({ development: false, optimize: opt });
}

/** A two-component app where `Child`'s `showBadge` prop never varies (foldable). */
function writeFoldableApp(): { dir: string; child: string; parent: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'shake-reg-'));
  const child = path.join(dir, 'Child.svelte');
  const parent = path.join(dir, 'Parent.svelte');
  writeFileSync(
    child,
    `<script>let { showBadge = false, label } = $props();</script>
{#if showBadge}<span class="badge">★</span>{/if}
<strong>{label}</strong>
<style>.badge { color: gold; } .unused { color: red; }</style>`,
  );
  writeFileSync(
    parent,
    `<script>import Child from './Child.svelte';</script>
<Child label="hello" />
<Child label="world" />`,
  );
  return { dir, child, parent };
}

describe('ComponentRegistry.prepareShake', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  test('slims a component and caches its source by absolute path', async () => {
    const app = writeFoldableApp();
    dir = app.dir;
    const registry = makeRegistry(true);

    await registry.prepareShake(app.dir);

    const cache = shakenSources(registry);
    // The whole-app scan covers every component, so both are cached...
    expect(cache.has(app.parent)).toBe(true);
    const slimmedChild = cache.get(app.child);
    // ...but Child's entry is the slimmed output: prop folded, CSS gone.
    expect(slimmedChild).toBeDefined();
    expect(slimmedChild).not.toContain('showBadge');
    expect(slimmedChild).not.toContain('.unused');
  });

  test('exclude leaves the matched component out of the cache (compiles from disk)', async () => {
    const app = writeFoldableApp();
    dir = app.dir;
    const registry = makeRegistry({ enabled: true, exclude: ['**/Child.svelte'] });

    await registry.prepareShake(app.dir);

    const cache = shakenSources(registry);
    // Excluded → absent from the cache, so the onLoad handler falls back to disk.
    expect(cache.has(app.child)).toBe(false);
    // The scan still covered Parent as a call site, so it remains cached.
    expect(cache.has(app.parent)).toBe(true);
  });

  test('logs a per-component before → after breakdown', async () => {
    const app = writeFoldableApp();
    dir = app.dir;
    const info = spyOn(logger, 'info');
    const registry = makeRegistry({ enabled: true });

    await registry.prepareShake(app.dir);

    const lines = info.mock.calls.map((c) => String(c[0]));
    // One of the two scanned components changed, so the count distinguishes changed from scanned.
    expect(lines.some((l) => /slimmed 1 of 2 component/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('→'))).toBe(true);
    info.mockRestore();
  });

  test('enabled: false skips shaking even when options object is present', async () => {
    const app = writeFoldableApp();
    dir = app.dir;
    const registry = makeRegistry({ enabled: false });

    await registry.prepareShake(app.dir);

    expect(shakenSources(registry).size).toBe(0);
  });

  test('warns and stays empty when the source directory is missing', async () => {
    const warn = spyOn(logger, 'warn');
    const registry = makeRegistry(true);

    await registry.prepareShake(path.join(tmpdir(), 'shake-does-not-exist-xyz'));

    expect(shakenSources(registry).size).toBe(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('no source directory'))).toBe(true);
    warn.mockRestore();
  });

  test('warns when the directory has no .svelte components', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'shake-reg-empty-'));
    const warn = spyOn(logger, 'warn');
    const registry = makeRegistry(true);

    await registry.prepareShake(dir);

    expect(shakenSources(registry).size).toBe(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('no .svelte components'))).toBe(true);
    warn.mockRestore();
  });
});
