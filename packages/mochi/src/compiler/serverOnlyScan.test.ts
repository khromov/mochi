import { describe, expect, test } from 'bun:test';
import { buildServerOnlyStubModule, scanServerOnlyExports } from './serverOnlyScan';

describe('scanServerOnlyExports', () => {
  test('detects const/let/var/function/class declarations', () => {
    const src = `
      export const a = 1;
      export let b = 2;
      export var c = 3;
      export function d() {}
      export async function e() {}
      export function* f() {}
      export class G {}
    `;
    const r = scanServerOnlyExports(src);
    expect(r.named.sort()).toEqual(['G', 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.hasDefault).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  test('detects named exports and aliases', () => {
    const src = `
      const a = 1; const b = 2;
      export { a, b as renamed };
    `;
    const r = scanServerOnlyExports(src);
    expect(r.named.sort()).toEqual(['a', 'renamed']);
    expect(r.hasDefault).toBe(false);
  });

  test('detects re-exports with named selector', () => {
    const src = `export { foo, bar as baz } from './other';`;
    const r = scanServerOnlyExports(src);
    expect(r.named.sort()).toEqual(['baz', 'foo']);
  });

  test('detects default export', () => {
    const src = `export default function () { return 1 }`;
    const r = scanServerOnlyExports(src);
    expect(r.hasDefault).toBe(true);
    expect(r.named).toEqual([]);
  });

  test('detects `export { x as default }`', () => {
    const src = `const x = 1; export { x as default };`;
    const r = scanServerOnlyExports(src);
    expect(r.hasDefault).toBe(true);
    expect(r.named).toEqual([]);
  });

  test('warns on `export *` re-exports', () => {
    const src = `export * from './other';`;
    const r = scanServerOnlyExports(src);
    expect(r.named).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });

  test('extracts destructured exports', () => {
    const src = `const obj = { a: 1, b: 2 }; export const { a, b } = obj;`;
    const r = scanServerOnlyExports(src);
    expect(r.named.sort()).toEqual(['a', 'b']);
    expect(r.warnings).toEqual([]);
  });

  test('ignores `export` keyword inside strings and comments', () => {
    const src = `
      // export const fake = 1;
      /* export const alsoFake = 2; */
      const s = "export const stringy = 3";
      export const real = 4;
    `;
    const r = scanServerOnlyExports(src);
    expect(r.named).toEqual(['real']);
  });

  test('handles template literal strings with backticks', () => {
    const src = `
      const t = \`export const inTemplate = 1\`;
      export const real = 2;
    `;
    const r = scanServerOnlyExports(src);
    expect(r.named).toEqual(['real']);
  });

  test('handles multi-line named export blocks', () => {
    const src = `
      const a = 1; const b = 2; const c = 3;
      export {
        a,
        b as second,
        c
      };
    `;
    const r = scanServerOnlyExports(src);
    expect(r.named.sort()).toEqual(['a', 'c', 'second']);
  });
});

describe('buildServerOnlyStubModule', () => {
  test('emits one stub per named export', () => {
    const stub = buildServerOnlyStubModule('parser.server.ts', {
      named: ['parseText', 'render'],
      hasDefault: false,
      warnings: [],
    });
    expect(stub).toContain('export const parseText =');
    expect(stub).toContain('export const render =');
    expect(stub).not.toContain('export default');
  });

  test('default stub throws when invoked, accessed, and constructed', async () => {
    const stub = buildServerOnlyStubModule('parser.server.ts', {
      named: [],
      hasDefault: true,
      warnings: [],
    });
    expect(stub).toContain('export default __default');
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`)) as { default: unknown };
    const d = mod.default as ((...a: unknown[]) => unknown) & (new () => unknown) & { foo?: unknown };
    expect(() => d()).toThrow(/server-only/);
    expect(() => d.foo).toThrow(/server-only/);
    expect(() => new d()).toThrow(/server-only/);
  });

  test('stub throws when invoked', async () => {
    const stub = buildServerOnlyStubModule('parser.server.ts', {
      named: ['parseText'],
      hasDefault: false,
      warnings: [],
    });
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`)) as { parseText: unknown };
    expect(() => (mod.parseText as () => unknown)()).toThrow(/server-only/);
  });

  test('stub throws on property access', async () => {
    const stub = buildServerOnlyStubModule('parser.server.ts', {
      named: ['db'],
      hasDefault: false,
      warnings: [],
    });
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`)) as { db: { query: unknown } };
    expect(() => mod.db.query).toThrow(/server-only/);
  });

  test('stub throws when used with `new`', async () => {
    const stub = buildServerOnlyStubModule('parser.server.ts', {
      named: ['Klass'],
      hasDefault: false,
      warnings: [],
    });
    const mod = (await import(`data:text/javascript;base64,${Buffer.from(stub).toString('base64')}`)) as { Klass: new () => unknown };
    expect(() => new mod.Klass()).toThrow(/server-only/);
  });
});

describe('scanServerOnlyExports — identifier safety', () => {
  test('warns on string-named exports and excludes them from named', () => {
    const src = `const x = 1; export { x as "weird-name" };`;
    const r = scanServerOnlyExports(src);
    expect(r.named).toEqual([]);
    expect(r.warnings.some((w) => w.includes('weird-name'))).toBe(true);
  });
});
