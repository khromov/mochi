// The warning's claim and its cure, run for real: the fixture is compiled, bundled and minified the way the client
// bundle is, then driven through a DOM.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { minifyJsChunks, type MochiJsMinifier } from './jsMinifier';
import { findOxcDroppedCalls, oxcDroppedCallReplacement } from './oxcDroppedCalls';

const FIXTURE = path.join(import.meta.dir, '..', '__fixtures__', 'oxc-dropped-calls', 'Filters.svelte');

let dir: string;
let original: string;
let builds = 0;

interface App {
  mount(target: Element): void;
  flushSync(): void;
}

async function build(source: string, minifier: MochiJsMinifier): Promise<string> {
  const id = (builds += 1);
  const componentPath = path.join(dir, `Filters${id}.svelte`);
  const entryPath = path.join(dir, `entry${id}.js`);
  writeFileSync(componentPath, source);
  writeFileSync(
    entryPath,
    `import { mount, flushSync } from 'svelte';\nimport Filters from './Filters${id}.svelte';\nglobalThis.__oxcDroppedApp = { mount: (target) => mount(Filters, { target }), flushSync };\n`,
  );
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    minify: true,
    plugins: [
      {
        name: 'svelte',
        setup(builder) {
          builder.onLoad({ filter: /\.svelte$/ }, async (args) => ({
            contents: compile(await Bun.file(args.path).text(), { generate: 'client', filename: args.path }).js.code,
            loader: 'js',
          }));
        },
      },
    ],
  });
  const bundled = await result.outputs[0]!.text();
  return minifier === 'oxc' ? (await minifyJsChunks([{ fileName: 'app.js', code: bundled }]))[0]! : bundled;
}

/** Page 1 → "Next page" twice → add a filter; returns the page shown afterwards. */
async function pageAfterAddingAFilter(source: string, minifier: MochiJsMinifier): Promise<string> {
  const bundlePath = path.join(dir, `bundle${builds + 1}.mjs`);
  writeFileSync(bundlePath, await build(source, minifier));
  await import(pathToFileURL(bundlePath).href);
  const app = (globalThis as unknown as { __oxcDroppedApp: App }).__oxcDroppedApp;
  document.body.innerHTML = '<div id="root"></div>';
  app.mount(document.getElementById('root')!);
  app.flushSync();
  const click = (id: string) => {
    document.getElementById(id)!.click();
    app.flushSync();
  };
  click('next');
  click('next');
  expect(document.getElementById('page')!.textContent).toBe('3');
  click('add');
  return document.getElementById('page')!.textContent;
}

describe('a bare String(filters) in an $effect', () => {
  beforeAll(async () => {
    // Inside the package so the bundle resolves `svelte` from the project's node_modules.
    dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-oxc-dropped-e2e-'));
    // The fixture's rune module is the registry test's business; a same-line stub keeps the line numbers.
    original = (await Bun.file(FIXTURE).text()).replace("import { watchAll } from './tracker.svelte';", 'const watchAll = (_values: string[]) => {};');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("resets the page under 'bun'", async () => {
    expect(await pageAfterAddingAFilter(original, 'bun')).toBe('1');
  });

  test("stops resetting the page under 'oxc', which is what the warning reports", async () => {
    expect(await pageAfterAddingAFilter(original, 'oxc')).toBe('3');
  });

  test("resets the page under 'oxc' once the warning's suggested replacement is applied", async () => {
    const compiled = compile(original, { generate: 'client', filename: FIXTURE }).js.code;
    const [dropped] = findOxcDroppedCalls(original, FIXTURE, compiled);
    expect(dropped?.call).toBe('String(filters)');
    const fixed = original.replace(`${dropped!.call};`, oxcDroppedCallReplacement(dropped!));
    expect(fixed).toContain('`${filters}`;');

    expect(findOxcDroppedCalls(fixed, FIXTURE, compile(fixed, { generate: 'client', filename: FIXTURE }).js.code)).toEqual([]);
    expect(await pageAfterAddingAFilter(fixed, 'oxc')).toBe('1');
  });
});
