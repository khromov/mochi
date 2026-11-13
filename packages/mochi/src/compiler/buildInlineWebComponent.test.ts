import { describe, expect, test } from 'bun:test';
import { assertNoModuleSyntax, buildInlineWebComponent } from './buildInlineWebComponent';

describe('buildInlineWebComponent', () => {
  test.each(['./web-components/ServerIsland.ts', './web-components/LiveReload.ts'])('%s is built as a self-contained IIFE', async (entry) => {
    const js = await buildInlineWebComponent(entry);

    expect(js.startsWith('(()=>{')).toBe(true);
    expect(js.trimEnd().endsWith('})();')).toBe(true);
  });
});

describe('assertNoModuleSyntax', () => {
  test('rejects static imports and exports', () => {
    expect(() => assertNoModuleSyntax('esm.js', 'import{a}from"./a.js";a();')).toThrow(/classic <script>/);
    expect(() => assertNoModuleSyntax('esm.js', 'export const a=1;')).toThrow(/1 export/);
  });

  test('allows plain scripts and dynamic import()', () => {
    expect(() => assertNoModuleSyntax('ok.js', '(()=>{customElements.define("x-y",class extends HTMLElement{})})();')).not.toThrow();
    expect(() => assertNoModuleSyntax('ok.js', 'import("./x.js").then(m=>m.go());')).not.toThrow();
  });
});
