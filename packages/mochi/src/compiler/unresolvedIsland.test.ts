import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry, formatCompileErrors, type MochiCompileError } from './ComponentRegistry';
import { encodeSourcePath } from './manifestPaths';
import { requestContext } from '../runtime/requestContext';
import type { MochiRequestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

describe('unresolved-island compile errors', () => {
  let fixtureDir: string;
  let outDir: string;
  let registry: ComponentRegistry;
  let pagePath: string;

  const BROKEN = '<h1>page</h1>\n<Unknown mochi:hydrate />\n';

  beforeAll(async () => {
    fixtureDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-unresolved-fixture-'));
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-unresolved-'));
    registry = new ComponentRegistry({ development: true, outDir });
    pagePath = path.join(fixtureDir, 'Page.svelte');
    writeFileSync(pagePath, BROKEN);
    await registry.compile(pagePath);
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a directive without a matching import records an unresolved-island error', () => {
    const errs = registry.getErrors().filter((e) => e.kind === 'unresolved-island');
    expect(errs).toEqual([{ kind: 'unresolved-island', component: 'Unknown', directive: 'mochi:hydrate', filePath: pagePath, importSource: null }]);
  });

  test('a forced recompile (compile-cache hit) re-reports the error without duplicating it', async () => {
    await registry.compileAll([pagePath], { force: true });
    const errs = registry.getErrors().filter((e) => e.kind === 'unresolved-island');
    expect(errs).toHaveLength(1);
  });

  test('fixing the file clears the error on recompile', async () => {
    writeFileSync(pagePath, '<h1>page</h1>\n');
    await registry.compileAll([pagePath], { force: true });
    expect(registry.getErrors().filter((e) => e.kind === 'unresolved-island')).toHaveLength(0);
  });
});

describe('formatCompileErrors for unresolved islands', () => {
  test('no-import variant names the component, directive, file, and the wrap workaround', () => {
    const errors: MochiCompileError[] = [
      { kind: 'unresolved-island', component: 'Foo', directive: 'mochi:hydrate', filePath: path.resolve('src/pages/Index.svelte'), importSource: null },
    ];
    const msg = formatCompileErrors(errors);
    expect(msg).toContain('<Foo mochi:hydrate>');
    expect(msg).toContain('src/pages/Index.svelte');
    expect(msg).toContain('has no matching import');
    expect(msg).toContain('wrap it in a local .svelte component');
  });

  test('the displayed path never carries Windows backslashes', () => {
    const errors: MochiCompileError[] = [
      { kind: 'unresolved-island', component: 'Foo', directive: 'mochi:hydrate', filePath: path.join(process.cwd(), 'src\\pages\\Index.svelte'), importSource: null },
    ];
    expect(formatCompileErrors(errors)).not.toContain('\\');
  });

  test('third-party package-import variant names the specifier and the wrap workaround', () => {
    const errors: MochiCompileError[] = [
      { kind: 'unresolved-island', component: 'Widget', directive: 'mochi:hydrate', filePath: path.resolve('src/Page.svelte'), importSource: 'some-ui-lib' },
    ];
    const msg = formatCompileErrors(errors);
    expect(msg).toContain('<Widget mochi:hydrate>');
    expect(msg).toContain('"some-ui-lib" is a third-party package import');
    expect(msg).toContain('Wrap the component in a local .svelte file');
  });
});

describe('named-export islands', () => {
  const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'named-island', 'Page.svelte');
  const BARREL = path.join(import.meta.dir, '..', '__fixtures__', 'named-island', 'Barrel.svelte');
  const islandKey = `Inner_${Bun.hash(`${encodeSourcePath(BARREL)}#Inner`).toString(36)}`;
  let outDir: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-named-island-'));
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(PAGE);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('a named relative .svelte import hydrates without errors', async () => {
    expect(registry.getErrors()).toHaveLength(0);
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(PAGE));

    expect(result.body).toContain(`component-name="${islandKey}"`);
    expect(result.body).toContain('data-inner-rendered');
    expect(result.body).not.toContain('__MOCHI_COMPONENT_URL__');
    expect(result.body).toMatch(/component-url="[^"]*\/client\/[^"]+"/);
  });

  test('the client entry imports the named export and registers the island', () => {
    const url = registry.getComponentEntryUrl(islandKey);
    expect(url).toBeDefined();
    const js = registry.getClientFile(url!);
    expect(js).toBeDefined();
    expect(js).toContain(islandKey);
  });

  test('renderComponent with exportName renders the named export, not the default', async () => {
    const result = await requestContext.run(makeCtx(), () => registry.renderComponent(BARREL, { label: 'via-export' }, { exportName: 'Inner' }));
    expect(result.body).toContain('data-inner-rendered');
    expect(result.body).toContain('via-export');
    expect(result.body).not.toContain('data-barrel-default');
  });

  test('renderComponent throws a descriptive error for a missing export', async () => {
    await expect(requestContext.run(makeCtx(), () => registry.renderComponent(BARREL, {}, { exportName: 'Nope' }))).rejects.toThrow(/no export "Nope"/);
  });
});
