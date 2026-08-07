import { describe, expect, test } from 'bun:test';
import { rewriteFrameworkComponentImports } from './frameworkComponents';

const FILE = '/app/src/CaptchaForm.svelte';

const wrap = (script: string, body = '<p>hi</p>') => `<script>\n${script}\n</script>\n\n${body}\n`;

describe('rewriteFrameworkComponentImports', () => {
  test('splits a named barrel import into a direct component import', () => {
    const out = rewriteFrameworkComponentImports(wrap(`import { MochiCaptcha } from 'mochi-framework/components';`), FILE);
    expect(out).toMatch(/import MochiCaptcha from ".*captcha\/MochiCaptcha\.svelte";/);
    expect(out).not.toContain(`from 'mochi-framework/components'`);
    expect(out).not.toContain('\\');
  });

  test('keeps the local alias', () => {
    const out = rewriteFrameworkComponentImports(wrap(`import { MochiCaptcha as Cap } from 'mochi-framework/components';`), FILE);
    expect(out).toMatch(/import Cap from ".*captcha\/MochiCaptcha\.svelte";/);
  });

  test('splits multiple specifiers into one import per component', () => {
    const out = rewriteFrameworkComponentImports(wrap(`import { MochiCaptcha, RawScript } from 'mochi-framework/components';`), FILE);
    expect(out).toMatch(/import MochiCaptcha from ".*captcha\/MochiCaptcha\.svelte";/);
    expect(out).toMatch(/import RawScript from ".*components\/RawScript\.svelte";/);
  });

  test('rewrites inside <script module>', () => {
    const source = `<script module>\nimport { RawScript } from 'mochi-framework/components';\n</script>\n\n<p>hi</p>\n`;
    const out = rewriteFrameworkComponentImports(source, FILE);
    expect(out).toMatch(/import RawScript from ".*components\/RawScript\.svelte";/);
  });

  test('returns the source unchanged without the specifier', () => {
    const source = wrap(`import Local from './Local.svelte';`);
    expect(rewriteFrameworkComponentImports(source, FILE)).toBe(source);
  });

  test('leaves a string literal containing the specifier alone', () => {
    const source = wrap(`const sample = "import { MochiCaptcha } from 'mochi-framework/components';";`, '<pre>{sample}</pre>');
    expect(rewriteFrameworkComponentImports(source, FILE)).toBe(source);
  });

  test('throws on an unknown export name, naming the file and the import', () => {
    expect(() => rewriteFrameworkComponentImports(wrap(`import { NotAComponent } from 'mochi-framework/components';`), FILE)).toThrow(
      /NotAComponent.*mochi-framework\/components|CaptchaForm\.svelte/,
    );
  });

  test('throws on a namespace import of the barrel', () => {
    expect(() => rewriteFrameworkComponentImports(wrap(`import * as Components from 'mochi-framework/components';`), FILE)).toThrow(/namespace import/);
  });

  test('throws on a re-export from the barrel', () => {
    expect(() => rewriteFrameworkComponentImports(wrap(`export { MochiCaptcha } from 'mochi-framework/components';`), FILE)).toThrow(/re-exporting/);
    expect(() => rewriteFrameworkComponentImports(wrap(`export * from 'mochi-framework/components';`), FILE)).toThrow(/re-exporting/);
  });
});
