import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../ComponentRegistry';

const COMPONENT_PATH = new URL('./ViewTransitions.svelte', import.meta.url).pathname;

describe('ViewTransitions', () => {
  let outDir: string;
  let registry: ComponentRegistry;

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
    const { head, body } = await registry.renderComponent(COMPONENT_PATH);
    expect(head).toContain('@view-transition');
    expect(head).toContain('navigation: auto');
    expect(head).toContain('::view-transition-old(root)');
    expect(head).toContain('@keyframes mochi-vt-out { to { opacity: 0; } }');
    // Renders nothing visible.
    expect(body.trim()).toBe('');
  });

  test('slide emits transform keyframes, not the fade ones', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { type: 'slide' });
    expect(head).toContain('translateX(-30px)');
    expect(head).toContain('translateX(30px)');
    expect(head).not.toContain('{ to { opacity: 0; } }');
  });

  test('duration is interpolated into the animation', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { duration: 500 });
    expect(head).toContain('500ms');
  });

  test('respects prefers-reduced-motion', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH);
    expect(head).toContain('prefers-reduced-motion: reduce');
  });

  test('regions confine the animation to the named element and freeze root', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { regions: 'card' });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-new(card) { animation: mochi-vt-in');
    // root is held still rather than cross-faded.
    expect(head).toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
    expect(head).not.toContain('::view-transition-old(root) { animation: mochi-vt-out');
  });

  test('regions accepts a list of names', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { regions: ['card', 'hero'] });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-new(hero) { animation: mochi-vt-in');
  });

  test('keep names a selector and freezes its group + snapshots', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { keep: '.banner' });
    expect(head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
    expect(head).toContain('::view-transition-group(mochi-vt-keep-banner)');
    expect(head).toContain('::view-transition-old(mochi-vt-keep-banner)');
    expect(head).toContain('::view-transition-new(mochi-vt-keep-banner) { animation: none; }');
  });

  test('keep accepts a list and sanitizes each selector into a readable ident', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { keep: ['.banner', '.gh-corner'] });
    expect(head).toContain('view-transition-name: mochi-vt-keep-banner;');
    expect(head).toContain('view-transition-name: mochi-vt-keep-gh-corner;');
  });

  test('keep names are order-independent', async () => {
    const a = await registry.renderComponent(COMPONENT_PATH, { keep: ['.banner', '.hero'] });
    const b = await registry.renderComponent(COMPONENT_PATH, { keep: ['.hero', '.banner'] });
    expect(a.head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
    expect(b.head).toContain('.banner { view-transition-name: mochi-vt-keep-banner; }');
  });

  test('keep still animates the page root by default', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { keep: '.banner' });
    expect(head).toContain('::view-transition-old(root) { animation: mochi-vt-out');
    // The reduced-motion fallback always freezes root, so scope the check to the
    // base rules: outside that media block, root must still animate (no `regions` freeze).
    const baseRules = head.slice(0, head.indexOf('@media (prefers-reduced-motion'));
    expect(baseRules).not.toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
  });

  test('keep composes with regions: root frozen, region animates, chrome held', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH, { regions: 'card', keep: '.banner' });
    expect(head).toContain('::view-transition-old(card) { animation: mochi-vt-out');
    expect(head).toContain('::view-transition-old(root), ::view-transition-new(root) { animation: none; }');
    expect(head).toContain('::view-transition-group(mochi-vt-keep-banner)');
  });

  test('without keep, no keep rules are emitted', async () => {
    const { head } = await registry.renderComponent(COMPONENT_PATH);
    expect(head).not.toContain('mochi-vt-keep-');
  });
});
