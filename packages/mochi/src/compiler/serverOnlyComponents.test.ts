import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { registerServerOnlyComponentStubs } from './serverOnlyComponents';
import { CLIENT_BUILD_DEFINE } from './serverOnlyModuleGuard';
import { ComponentRegistry } from './ComponentRegistry';
import { relForDisplay } from '../utils/index';

const SRC_DIR = path.resolve(import.meta.dir, '..');

const buildWithStubs = (entry: string) =>
  Bun.build({
    entrypoints: [entry],
    plugins: [{ name: 'stub', setup: registerServerOnlyComponentStubs }],
    target: 'browser',
    define: { ...CLIENT_BUILD_DEFINE },
    throw: false,
  });

// scanComponentExports slices the module script by start/end offsets the estree types don't declare; if Svelte ever
// renames or drops them, these fail loudly instead of the stub silently losing its named exports.
describe('svelte AST module-script offsets', () => {
  test('modern <script module> content exposes numeric start/end that slice to the script body', () => {
    const src = '<script module>export const probe_a = 1;</' + 'script>\n<h1>x</h1>';
    const content = parse(src, { modern: true }).module!.content as unknown as { start?: unknown; end?: unknown };
    expect(typeof content.start).toBe('number');
    expect(typeof content.end).toBe('number');
    expect(src.slice(content.start as number, content.end as number)).toBe('export const probe_a = 1;');
  });

  test('legacy <script context="module"> content exposes the same offsets', () => {
    const src = '<script context="module">export const probe_b = 2;</' + 'script>\n<h1>x</h1>';
    const content = parse(src, { modern: true }).module!.content as unknown as { start?: unknown; end?: unknown };
    expect(typeof content.start).toBe('number');
    expect(typeof content.end).toBe('number');
    expect(src.slice(content.start as number, content.end as number)).toBe('export const probe_b = 2;');
  });
});

describe('registerServerOnlyComponentStubs (unit)', () => {
  const tmpDir = mkdtempSync(path.join(SRC_DIR, '..', '.mochi-ssr-only-unit-'));
  // Created before the first Bun.build in this process — Bun's resolver caches a directory's node_modules absence,
  // so a fixture package added after an earlier build would never resolve.
  const pkgDir = path.join(tmpDir, 'node_modules', 'some-lib');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'some-lib', version: '1.0.0' }));
  writeFileSync(path.join(pkgDir, 'Thing.server.svelte'), `<h1>lib</h1>\n`);
  afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

  test('a *.server.svelte import is replaced by a throwing stub, its body never compiled', async () => {
    const marker = 'ssr-only-body-marker-9f3c2a';
    writeFileSync(path.join(tmpDir, 'Widget.server.svelte'), `<h1>${marker}</h1>\n`);
    const entry = path.join(tmpDir, 'entry.ts');
    writeFileSync(entry, `import Widget from './Widget.server.svelte';\nexport default Widget;\n`);

    const result = await buildWithStubs(entry);

    expect(result.success).toBe(true);
    const out = await result.outputs[0]!.text();
    // The stub is emitted; the component markup is never reached (no svelte compile ran).
    expect(out).toContain('server-only component');
    expect(out).not.toContain(marker);
  });

  test('the stub names the component with a forward-slash cwd-relative path', async () => {
    const componentPath = path.join(tmpDir, 'Pathy.server.svelte');
    writeFileSync(componentPath, `<h1>x</h1>\n`);
    const entry = path.join(tmpDir, 'entry-path.ts');
    writeFileSync(entry, `import Pathy from './Pathy.server.svelte';\nexport default Pathy;\n`);

    const result = await buildWithStubs(entry);

    expect(result.success).toBe(true);
    const out = await result.outputs[0]!.text();
    expect(out).toContain(relForDisplay(componentPath));
    expect(out).not.toContain('\\');
  });

  test('<script module> named exports are stubbed instead of failing the build', async () => {
    writeFileSync(
      path.join(tmpDir, 'Meta.server.svelte'),
      `<script module lang="ts">\n  export const meta = { title: 'x' };\n  export function helper(): number { return 1; }\n</scr` + `ipt>\n<h1>body</h1>\n`,
    );
    const entry = path.join(tmpDir, 'entry-meta.ts');
    writeFileSync(entry, `import Meta, { meta, helper } from './Meta.server.svelte';\nexport default [Meta, meta, helper];\n`);

    const result = await buildWithStubs(entry);

    expect(result.success).toBe(true);
    const out = await result.outputs[0]!.text();
    expect(out).toContain('server-only component');
    expect(out).not.toContain('No matching export');
  });

  test('a bare specifier resolves to the real node_modules file, once, regardless of importer directory', async () => {
    const nested = path.join(tmpDir, 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'reexport.ts'), `export { default as Nested } from 'some-lib/Thing.server.svelte';\n`);
    const entry = path.join(tmpDir, 'entry-bare.ts');
    writeFileSync(entry, `import Thing from 'some-lib/Thing.server.svelte';\nimport { Nested } from './nested/reexport.ts';\nexport default [Thing, Nested];\n`);

    const result = await buildWithStubs(entry);

    expect(result.success).toBe(true);
    const out = await result.outputs[0]!.text();
    // The real resolved path — not a fabricated `<importerDir>/some-lib/...` forked per importing directory.
    expect(out).toContain('node_modules/some-lib/Thing.server.svelte');
    expect(out).not.toContain('nested/some-lib');
  });

  test('an unresolvable bare specifier falls through to the default resolve error', async () => {
    const entry = path.join(tmpDir, 'entry-missing.ts');
    writeFileSync(entry, `import Ghost from 'no-such-lib/Ghost.server.svelte';\nexport default Ghost;\n`);

    const result = await buildWithStubs(entry);

    expect(result.success).toBe(false);
    const messages = result.logs.map((l) => String(l.message ?? l)).join('\n');
    expect(messages).toContain('Could not resolve');
    expect(messages).not.toContain('ENOENT');
  });
});

const FIXTURE_PAGE = path.join(SRC_DIR, '__fixtures__', 'ssr-only-barrel', 'Page.svelte');

describe('SSR-only components stay out of island client bundles (integration)', () => {
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-ssr-only-barrel-'));
    registry = new ComponentRegistry({ development: false, outDir });
    await registry.compile(FIXTURE_PAGE);
  });

  afterAll(() => rmSync(outDir, { recursive: true, force: true }));

  test('client bundle drops the barrel-pulled ViewTransitions/RawScript but keeps MochiCaptcha', () => {
    const joined = [...registry.getClientFiles().entries()]
      .filter(([url]) => url.endsWith('.js'))
      .map(([, src]) => src)
      .join('\n');

    // RawScript's `node:fs` import is the definitive server-only telltale — present before the fix, gone after.
    expect(joined).not.toContain('readFileSync');
    // The real interactive island (imported from the same barrel) still ships.
    expect(joined).toContain('captcha-hint');
  });
});
