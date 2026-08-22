import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from './ComponentRegistry';
import { requestContext } from '../runtime/requestContext';
import { MochiCookieJar } from '../runtime/cookies';

// Regression for the dev-HMR stale-module bug: after a `.svelte` edit and a
// forced recompile, the SSR render must reflect the new source. Previously the
// rebuilt entry was re-imported via `import(url + '?t=…')`, whose query-string
// cache-busting is not honored on every platform (notably Windows), so the
// render kept returning the previous module until the dev server restarted.
//
// `recompileBundle.test.ts` stubs `compileAll`, so this is the only coverage
// that exercises the real Bun.build + dynamic-import re-evaluation path.
describe('SSR re-import picks up source edits without a restart', () => {
  let dir: string;
  let outDir: string;
  let registry: ComponentRegistry;
  let component: string;

  const render = (file: string): Promise<string> => {
    const ctx = {
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
    return requestContext.run(ctx, async () => (await registry.renderComponent(file)).body);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-reimport-test-'));
    outDir = path.join(dir, '.mochi');
    registry = new ComponentRegistry({ development: true, outDir });
    component = path.join(dir, 'Comp.svelte');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('forced recompile re-evaluates the rebuilt module', async () => {
    writeFileSync(component, '<div>VALUE_FIRST</div>');
    await registry.compileAll([component]);
    expect(await render(component)).toContain('VALUE_FIRST');

    writeFileSync(component, '<div>VALUE_SECOND</div>');
    await registry.compileAll([component], { force: true });

    const after = await render(component);
    expect(after).toContain('VALUE_SECOND');
    expect(after).not.toContain('VALUE_FIRST');
  });

  test('recompileChanged on the entry re-evaluates the rebuilt module', async () => {
    writeFileSync(component, '<div>ALPHA</div>');
    await registry.compileAll([component]);
    expect(await render(component)).toContain('ALPHA');

    writeFileSync(component, '<div>BRAVO</div>');
    await registry.recompileChanged(component);

    const after = await render(component);
    expect(after).toContain('BRAVO');
    expect(after).not.toContain('ALPHA');
  });
});
