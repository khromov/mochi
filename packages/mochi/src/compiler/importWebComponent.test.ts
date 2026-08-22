import { describe, expect, test } from 'bun:test';
import { importWebComponent, transformImportWebComponent } from './importWebComponent';

describe('transformImportWebComponent', () => {
  test('server: rewrites the call to a no-op, dropping the specifier', () => {
    const out = transformImportWebComponent(`await importWebComponent('./click-counter.ts');`, 'server');
    expect(out).toBe('await Promise.resolve();');
    expect(out).not.toContain('click-counter');
  });

  test('client: rewrites the call to a dynamic import, preserving the literal', () => {
    const out = transformImportWebComponent(`await importWebComponent('./click-counter.ts');`, 'client');
    expect(out).toBe(`await import('./click-counter.ts');`);
  });

  test('handles npm specifiers and double quotes', () => {
    const src = `importWebComponent("@github/relative-time-element")`;
    expect(transformImportWebComponent(src, 'client')).toBe(`import("@github/relative-time-element")`);
    expect(transformImportWebComponent(src, 'server')).toBe('Promise.resolve()');
  });

  test('rewrites every call site', () => {
    const src = `await importWebComponent('a');\nawait importWebComponent('b');`;
    expect(transformImportWebComponent(src, 'client')).toBe(`await import('a');\nawait import('b');`);
  });

  test('leaves code without the call untouched', () => {
    const src = `const x = 1;\nimport Foo from './foo';`;
    expect(transformImportWebComponent(src, 'client')).toBe(src);
    expect(transformImportWebComponent(src, 'server')).toBe(src);
  });
});

describe('importWebComponent runtime fallback', () => {
  test('is an SSR-safe no-op that resolves', async () => {
    await expect(importWebComponent('./anything.ts')).resolves.toBeUndefined();
  });
});
