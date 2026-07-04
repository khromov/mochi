import { describe, expect, test } from 'bun:test';
import { buildInlineWebComponent } from './buildInlineWebComponent';
import { checkEnvironment } from './checkEnvironment';

// These verify that expensive, process-stable startup work is memoized rather
// than repeated on every Mochi.serve()/build() call. A memoized function
// returns the SAME promise object on repeated calls, which proves the
// underlying work (a full Bun.build+minify, an env probe) runs only once.

describe('startup memoization', () => {
  test('buildInlineWebComponent returns the same promise per relPath', () => {
    const a = buildInlineWebComponent('./web-components/ServerIsland.ts');
    const b = buildInlineWebComponent('./web-components/ServerIsland.ts');
    expect(a).toBe(b);
  });

  test('buildInlineWebComponent still produces a correct, non-empty bundle', async () => {
    const script = await buildInlineWebComponent('./web-components/ServerIsland.ts');
    expect(script.length).toBeGreaterThan(0);
    // The ServerIsland web component registers a custom element; the minified
    // bundle must still reference the custom-element registry.
    expect(script).toContain('customElements');
  });

  test('checkEnvironment returns the same promise across calls', () => {
    expect(checkEnvironment()).toBe(checkEnvironment());
  });

  test('checkEnvironment still resolves the installed Svelte version', async () => {
    const { svelteVersion } = await checkEnvironment();
    expect(svelteVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
