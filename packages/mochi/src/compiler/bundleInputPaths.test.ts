import { describe, expect, test } from 'bun:test';
import { cleanInputPath, cleanInputs } from './bundleInputPaths';
import { SSR_ONLY_COMPONENT_NAMESPACE } from './serverOnlyComponents';

describe('cleanInputPath', () => {
  test('keeps the store version segment so two installed copies stay distinct', () => {
    // The production regression: mode-watcher pulls runed@0.25.0 while svelte-toolbelt pulls runed@0.23.4, and both
    // land in one island bundle. Dropping the version collapsed them onto one key and crashed the panel's keyed each.
    const paths = ['../../node_modules/.bun/runed@0.25.0/node_modules/runed/dist/index.js', '../../node_modules/.bun/runed@0.23.4/node_modules/runed/dist/index.js'].map(
      cleanInputPath,
    );

    expect(paths).toEqual(['runed@0.25.0/dist/index.js', 'runed@0.23.4/dist/index.js']);
    expect(new Set(paths).size).toBe(2);
  });

  test('keeps the store segment for scoped packages', () => {
    expect(cleanInputPath('../../node_modules/.bun/@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/x.js')).toBe('@scope+pkg@1.0.0/dist/x.js');
  });

  test('strips a leading node_modules under the hoisted layout', () => {
    expect(cleanInputPath('../../node_modules/runed/dist/index.js')).toBe('runed/dist/index.js');
    expect(cleanInputPath('node_modules/svelte/src/index.js')).toBe('svelte/src/index.js');
  });

  test('leaves a nested node_modules copy addressable', () => {
    const nested = 'node_modules/mode-watcher/node_modules/runed/dist/index.js';
    expect(cleanInputPath(nested)).toBe('mode-watcher/node_modules/runed/dist/index.js');
    expect(cleanInputPath(nested)).not.toBe(cleanInputPath('node_modules/svelte-toolbelt/node_modules/runed/dist/index.js'));
  });

  test('leaves a project-relative source path alone', () => {
    expect(cleanInputPath('src/demos/mode-watcher/ModeControls.svelte')).toBe('src/demos/mode-watcher/ModeControls.svelte');
  });

  test('distinguishes the two virtual stub namespaces', () => {
    const ssrOnly = cleanInputPath(`${SSR_ONLY_COMPONENT_NAMESPACE}:/app/src/Widget.server.svelte`);
    const serverOnly = cleanInputPath('mochi-server-only:/app/src/Widget.server.svelte');

    expect(ssrOnly).toBe('/app/src/Widget.server.svelte (SSR-only component stub)');
    expect(serverOnly).toBe('/app/src/Widget.server.svelte (server-only stub)');
    expect(ssrOnly).not.toBe(serverOnly);
  });

  test('renders Windows paths with forward slashes', () => {
    const cleaned = cleanInputPath('..\\..\\node_modules\\.bun\\runed@0.25.0\\node_modules\\runed\\dist\\index.js');

    expect(cleaned).toBe('runed@0.25.0/dist/index.js');
    expect(cleaned).not.toContain('\\');
  });
});

describe('cleanInputs', () => {
  test('drops fully tree-shaken SSR-only stubs but keeps ones with retained bytes', () => {
    const cleaned = cleanInputs([
      { path: `${SSR_ONLY_COMPONENT_NAMESPACE}:/app/src/Gone.server.svelte`, size: 0 },
      { path: `${SSR_ONLY_COMPONENT_NAMESPACE}:/app/src/Kept.server.svelte`, size: 42 },
      { path: 'node_modules/svelte/src/index.js', size: 0 },
    ]);

    expect(cleaned).toEqual([
      { path: '/app/src/Kept.server.svelte (SSR-only component stub)', size: 42 },
      { path: 'svelte/src/index.js', size: 0 },
    ]);
  });

  test('yields unique paths for a bundle holding two versions of one package', () => {
    const paths = cleanInputs(
      ['runed@0.25.0', 'runed@0.23.4'].flatMap((v) =>
        ['dist/index.js', 'dist/utilities/watch/watch.svelte.js'].map((f) => ({ path: `../../node_modules/.bun/${v}/node_modules/runed/${f}`, size: 10 })),
      ),
    ).map((i) => i.path);

    expect(new Set(paths).size).toBe(paths.length);
  });
});
