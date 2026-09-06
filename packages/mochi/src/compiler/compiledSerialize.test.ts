import { describe, expect, test } from 'bun:test';
import { createModuleRef, isModuleRef, serializeCompiledValue } from './compiledSerialize';

describe('serializeCompiledValue', () => {
  test('round-trips rich types devalue supports but JSON does not', () => {
    const value = { when: new Date(0), set: new Set([1, 2]), map: new Map([['a', 1]]), big: 10n, re: /ab+c/gi, missing: undefined, nan: Number.NaN };
    const { expression, imports } = serializeCompiledValue(value);
    expect(imports).toEqual([]);
    const revived = new Function(`return ${expression};`)() as typeof value;
    expect(revived.when).toEqual(new Date(0));
    expect([...revived.set]).toEqual([1, 2]);
    expect(revived.map.get('a')).toBe(1);
    expect(revived.big).toBe(10n);
    expect(revived.re.source).toBe('ab+c');
    expect('missing' in revived).toBe(true);
    expect(revived.missing).toBeUndefined();
    expect(Number.isNaN(revived.nan)).toBe(true);
  });

  test('preserves cycles and shared references', () => {
    const shared = { n: 1 };
    const value: Record<string, unknown> = { a: shared, b: shared };
    value.self = value;
    const revived = new Function(`return ${serializeCompiledValue(value).expression};`)() as Record<string, unknown>;
    expect(revived.a).toBe(revived.b);
    expect(revived.self).toBe(revived);
  });

  test('turns module refs into import identifiers, deduped by specifier', () => {
    const value = { intro: createModuleRef('../docs/10-intro.md'), same: createModuleRef('../docs/10-intro.md'), other: createModuleRef('../docs/20-next.md') };
    const { expression, imports } = serializeCompiledValue(value);
    expect(imports).toEqual([
      { identifier: '__mochi_ref_0__', specifier: '../docs/10-intro.md' },
      { identifier: '__mochi_ref_1__', specifier: '../docs/20-next.md' },
    ]);
    expect(expression).toBe('{intro:__mochi_ref_0__,same:__mochi_ref_0__,other:__mochi_ref_1__}');
  });

  // A compiled value is spliced into a `<script>` block, so a literal `</script>` anywhere in it would close the tag at
  // the HTML-parsing layer. The demo source viewer bakes highlighted Svelte source, so this is a real payload.
  test('escapes markup that would otherwise close the surrounding script tag', () => {
    const payload = `<script>alert(1)</${'script'}>`;
    for (const mode of ['devalue', 'json'] as const) {
      const { expression } = serializeCompiledValue({ html: payload }, mode);
      expect(expression).not.toContain(`</${'script'}`);
      expect(new Function(`return ${expression};`)()).toEqual({ html: payload });
    }
  });

  test('json mode emits a JSON.parse call and rejects module refs', () => {
    expect(new Function(`return ${serializeCompiledValue({ a: [1, 2] }, 'json').expression};`)()).toEqual({ a: [1, 2] });
    expect(serializeCompiledValue({ a: 1 }, 'json').expression).toStartWith('JSON.parse(');
    expect(() => serializeCompiledValue({ c: createModuleRef('./x.md') }, 'json')).toThrow(/moduleRef/);
  });

  test('accepts a custom serializer', () => {
    expect(serializeCompiledValue({ a: 1 }, () => '"custom"').expression).toBe('"custom"');
  });

  test('recognises markers across framework copies via a registry symbol', () => {
    // A `*.compiled.ts` module may hold a different `mochi-framework` instance than the compiler does, so the brand
    // must not depend on instance identity.
    expect(isModuleRef({ [Symbol.for('mochi.moduleRef')]: './x.md' })).toBe(true);
    expect(isModuleRef({ notAMarker: true })).toBe(false);
  });
});
