import { describe, expect, test } from 'bun:test';
import { buildInlineWebComponent } from './compiler/buildInlineWebComponent';
import { checkEnvironment } from './cli/checkEnvironment';

// These verify that expensive, process-stable startup work is memoized rather
// than repeated on every Mochi.serve()/build() call. A memoized function
// returns the SAME promise object on repeated calls, which proves the
// underlying work (an env probe) runs only once.

describe('startup memoization', () => {
  test('buildInlineWebComponent produces a correct, non-empty bundle', async () => {
    const script = await buildInlineWebComponent('./web-components/ServerIsland.ts');
    expect(script.length).toBeGreaterThan(0);
    // The registration call and the tag-name literal both survive minification,
    // so their presence proves the element is actually defined, not just referenced.
    expect(script).toContain('customElements.define');
    expect(script).toContain('mochi-server-island');
  });

  // Relies on run-tests.ts per-file process isolation for fresh module-level
  // memoization state; under a shared process a prior caller would have primed it.
  test('checkEnvironment returns the same promise across calls', () => {
    expect(checkEnvironment()).toBe(checkEnvironment());
  });

  test('checkEnvironment still resolves the installed Svelte version', async () => {
    const { svelteVersion } = await checkEnvironment();
    expect(svelteVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
