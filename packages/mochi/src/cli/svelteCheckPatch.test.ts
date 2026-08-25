import { describe, expect, test } from 'bun:test';
import { injectMochiBranch } from './svelteCheckPatch';

// Mirror of the relevant slice of svelte-check's bundled svelte2tsx
// `handleAttribute`: the `--` CSS-prop branch followed by `element.addProp`.
const UNPATCHED = `        : (name, value) => {
            if (attr.name.startsWith('--')) {
                name.unshift('...__sveltets_2_cssProp({');
                if (!value) {
                    value = ['""'];
                }
                value.push('})');
            }
            element.addProp(name, value);
        };`;

describe('injectMochiBranch', () => {
  test('injects the mochi: branch before addProp', () => {
    const { source, changed, reason } = injectMochiBranch(UNPATCHED);
    expect(changed).toBe(true);
    expect(reason).toBeUndefined();
    expect(source).toContain("else if (attr.name.startsWith('mochi:')) {");
    expect(source).toContain("name.unshift('...__sveltets_2_empty({');");
    // The new branch sits between the css block and the addProp call.
    const mochiIdx = source.indexOf("startsWith('mochi:')");
    const addPropIdx = source.indexOf('element.addProp(name, value);');
    expect(mochiIdx).toBeGreaterThan(-1);
    expect(mochiIdx).toBeLessThan(addPropIdx);
  });

  test('is idempotent — re-running makes no change', () => {
    const once = injectMochiBranch(UNPATCHED).source;
    const { source: twice, changed, reason } = injectMochiBranch(once);
    expect(changed).toBe(false);
    expect(reason).toBe('already patched');
    expect(twice).toBe(once);
  });

  test('returns a reason (no throw) when the anchor is missing', () => {
    const { changed, reason } = injectMochiBranch('export const unrelated = 1;\n');
    expect(changed).toBe(false);
    expect(reason).toBe('handleAttribute anchor not found');
  });

  test('preserves the indentation of the addProp line', () => {
    const { source } = injectMochiBranch(UNPATCHED);
    // addProp is indented 12 spaces; the injected branch opener matches.
    expect(source).toContain("\n            else if (attr.name.startsWith('mochi:')) {");
  });
});
