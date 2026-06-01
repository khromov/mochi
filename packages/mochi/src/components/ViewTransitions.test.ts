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
});
