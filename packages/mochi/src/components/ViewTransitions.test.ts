import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';
import { requestContext, type MochiRequestContext } from '../runtime/requestContext';

const COMPONENT_PATH = path.join(import.meta.dir, 'ViewTransitions.svelte');

describe('ViewTransitions', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  // The component reads getRequestContext().locals for its once-per-page guard,
  // so every render must run inside a request context — the same ALS the
  // compiled SSR output shares via globalThis.
  const renderInRequest = <T>(fn: () => Promise<T>) => requestContext.run({ locals: {}, islandProps: new Map() } as unknown as MochiRequestContext, fn);

  // A fresh context per call gives each test an unclaimed page (the guard sets
  // a flag on locals, so reusing one context would suppress later renders).
  const render = (props?: Record<string, unknown>) => renderInRequest(() => registry.renderComponent(COMPONENT_PATH, props));

  beforeAll(async () => {
    // Must live inside the package so bare `svelte/*` imports in the compiled
    // SSR output resolve against the framework's own node_modules.
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-vt-test-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(COMPONENT_PATH);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('opts into cross-document transitions and defaults to fade', async () => {
    const { head, body } = await render();
    expect(head).toContain('@view-transition');
    expect(head).toContain('navigation: auto');
    expect(head).toContain('::view-transition-old(root)');
    expect(head).toContain('@keyframes mochi-vt-out { to { opacity: 0; } }');
    // Renders nothing visible.
    expect(body.trim()).toBe('');
  });

  test('slide emits transform keyframes, not the fade ones', async () => {
    const { head } = await render({ type: 'slide' });
    expect(head).toContain('translateX(-30px)');
    expect(head).toContain('translateX(30px)');
    expect(head).not.toContain('{ to { opacity: 0; } }');
  });

  test.each([
    ['scale', 'scale(0.92)'],
    ['blur', 'blur(6px)'],
    ['flip', 'rotateY(-90deg)'],
  ])('%s emits its own keyframes, not the fade ones', async (type, marker) => {
    const { head } = await render({ type });
    expect(head).toContain(marker);
    expect(head).not.toContain('{ to { opacity: 0; } }');
  });

  test('duration is interpolated into the animation', async () => {
    const { head } = await render({ duration: 500 });
    expect(head).toContain('500ms');
  });

  test('custom wraps the supplied bodies in keyframes and the rules still reference them', async () => {
    const { head } = await render({ custom: { out: 'to { transform: rotate(8deg) }', in: 'from { transform: rotate(-8deg) }' } });
    expect(head).toContain('@keyframes mochi-vt-out { to { transform: rotate(8deg) } }');
    expect(head).toContain('@keyframes mochi-vt-in { from { transform: rotate(-8deg) } }');
    expect(head).toContain('::view-transition-old(root) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-new(root) { animation: mochi-vt-in');
  });

  test('custom overrides the type preset', async () => {
    const { head } = await render({ type: 'slide', custom: { out: 'to { opacity: 0 }', in: 'from { opacity: 0 }' } });
    expect(head).toContain('@keyframes mochi-vt-out { to { opacity: 0 } }');
    expect(head).not.toContain('translateX');
  });

  test('custom accepts a single side and emits an empty keyframes block for the other', async () => {
    const { head } = await render({ custom: { in: 'from { opacity: 0 }' } });
    expect(head).toContain('@keyframes mochi-vt-in { from { opacity: 0 } }');
    expect(head).toContain('@keyframes mochi-vt-out {  }');
  });

  test('custom with neither side throws', async () => {
    await expect(render({ custom: {} })).rejects.toThrow('requires at least an `out` or `in`');
  });

  test('custom rejects a body containing "<"', async () => {
    await expect(render({ custom: { out: 'to {}</style><script>' } })).rejects.toThrow('must not contain "<"');
  });

  test('easing is interpolated into the animation rules', async () => {
    const { head } = await render({ easing: 'linear' });
    expect(head).toContain('mochi-vt-out 250ms linear both');
  });

  test('easing defaults to ease', async () => {
    const { head } = await render();
    expect(head).toContain('mochi-vt-out 250ms ease both');
  });

  test('easing rejects a value containing "<"', async () => {
    await expect(render({ easing: '</style><script>' })).rejects.toThrow('easing must not contain "<"');
  });

  test('respects prefers-reduced-motion', async () => {
    const { head } = await render();
    expect(head).toContain('prefers-reduced-motion: reduce');
  });

  test('regions confine the animation to the named element and freeze root', async () => {
    const { head } = await render({ regions: 'card' });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-new(card) { animation: mochi-vt-in');
    // root is held still rather than cross-faded.
    expect(head).toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
    expect(head).not.toContain('::view-transition-old(root) { animation: mochi-vt-out');
  });

  test('regions accepts a list of names', async () => {
    const { head } = await render({ regions: ['card', 'hero'] });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-new(hero) { animation: mochi-vt-in');
  });

  test('keep names a selector and freezes its group + snapshots', async () => {
    const { head } = await render({ keepElementSelectors: '.banner' });
    expect(head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
    expect(head).toContain('::view-transition-group(mochi-vt-keep-banner)');
    expect(head).toContain('::view-transition-old(mochi-vt-keep-banner)');
    expect(head).toContain('::view-transition-new(mochi-vt-keep-banner) { animation: none; }');
  });

  test('keep accepts a list and sanitizes each selector into a readable ident', async () => {
    const { head } = await render({ keepElementSelectors: ['.banner', '.gh-corner'] });
    expect(head).toContain('view-transition-name: mochi-vt-keep-banner;');
    expect(head).toContain('view-transition-name: mochi-vt-keep-gh-corner;');
  });

  test('keep names are order-independent', async () => {
    const a = await render({ keepElementSelectors: ['.banner', '.hero'] });
    const b = await render({ keepElementSelectors: ['.hero', '.banner'] });
    expect(a.head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
    expect(b.head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
  });

  test('keep still animates the page root by default', async () => {
    const { head } = await render({ keepElementSelectors: '.banner' });
    expect(head).toContain('::view-transition-old(root) { animation: mochi-vt-out');
    // The reduced-motion fallback always freezes root, so scope the check to the
    // base rules: outside that media block, root must still animate (no `regions` freeze).
    const baseRules = head.slice(0, head.indexOf('@media (prefers-reduced-motion'));
    expect(baseRules).not.toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
  });

  test('keep composes with regions: root frozen, region animates, chrome held', async () => {
    const { head } = await render({ regions: 'card', keepElementSelectors: '.banner' });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
    expect(head).toContain('::view-transition-group(mochi-vt-keep-banner)');
  });

  test('without keep, no keep rules are emitted', async () => {
    const { head } = await render();
    expect(head).not.toContain('mochi-vt-keep-');
  });

  test('keep disambiguates selectors that sanitize to the same slug', async () => {
    const { head } = await render({ keepElementSelectors: ['.banner', '#banner'] });
    expect(head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
    expect(head).toContain('#banner { view-transition-name: mochi-vt-keep-banner-1; }');
  });

  test('keep falls back to the `el` slug for selectors with no alphanumerics', async () => {
    const { head } = await render({ keepElementSelectors: ['*', ':root > *'] });
    expect(head).toContain('* { view-transition-name: mochi-vt-keep-el; }');
    expect(head).toContain(':root > * { view-transition-name: mochi-vt-keep-root; }');
  });

  test('keep rejects selectors containing "<"', async () => {
    await expect(render({ keepElementSelectors: '</style><script>' })).rejects.toThrow('must not contain "<"');
  });

  test('throws when invoked as an island (isHydratable)', async () => {
    // The framework injects isHydratable: true on mochi:hydrate*/defer* invocations.
    await expect(render({ isHydratable: true })).rejects.toThrow('must not be hydrated');
  });

  test('throws on a non-finite or negative duration', async () => {
    await expect(render({ duration: NaN })).rejects.toThrow('duration must be a non-negative number');
    await expect(render({ duration: -100 })).rejects.toThrow('duration must be a non-negative number');
    await expect(render({ duration: Infinity })).rejects.toThrow('duration must be a non-negative number');
  });

  test('second instance in the same request warns and emits nothing', async () => {
    const warn = spyOn(console, 'warn');
    try {
      const [first, second] = await renderInRequest(async () => [await registry.renderComponent(COMPONENT_PATH), await registry.renderComponent(COMPONENT_PATH)]);
      expect(first.head).toContain('@view-transition');
      expect(second.head).not.toContain('@view-transition');
      expect(warn.mock.calls.flat().join(' ')).toContain('rendered more than once');
    } finally {
      warn.mockRestore();
    }
  });

  test('a new request gets a fresh claim', async () => {
    const a = await renderInRequest(() => registry.renderComponent(COMPONENT_PATH));
    const b = await renderInRequest(() => registry.renderComponent(COMPONENT_PATH));
    expect(a.head).toContain('@view-transition');
    expect(b.head).toContain('@view-transition');
  });
});
