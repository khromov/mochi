import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { renderMochiEnvClient, renderMochiEnvServer } from './virtualModuleTemplate';
import { clientBuildDefine, registerEsmEnvStrip, registerMochiEnvClient, registerSvelteModuleLoader } from './clientBuildLoaders';
import { serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { officialBackend } from './svelteCompilerBackend';

const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-virtual-env-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('rendered virtual module bodies', () => {
  test('bake isDev as a literal, not a reference', () => {
    expect(renderMochiEnvServer(true)).toContain('export const isDev = true');
    expect(renderMochiEnvServer(false)).toContain('export const isDev = false');
    expect(renderMochiEnvServer(true)).not.toContain('__MOCHI_DEV__');
  });

  test('mirror the render target per build', () => {
    expect(renderMochiEnvServer(false)).toContain('export const isServer = true; export const isBrowser = false;');
    expect(renderMochiEnvClient(false, 'cookies.ts', 'enhance.ts')).toContain('export const isServer = false; export const isBrowser = true;');
  });
});

// The reason the virtual module exists: a client bundle must not fall through to the real utils/env.ts.
describe('client bundles resolve the virtual module, not utils/env.ts', () => {
  async function buildProbe(name: string, development: boolean, source: string): Promise<string> {
    const entry = path.join(outDir, `${name}.ts`);
    await Bun.write(entry, source);
    // Same plugin order and define as the island build, so a new plugin claiming `mochi-framework` first is caught.
    const result = await Bun.build({
      entrypoints: [entry],
      plugins: [
        serverOnlyModuleGuard,
        {
          name: 'svelte-client',
          setup(build) {
            registerMochiEnvClient(build, development);
            registerEsmEnvStrip(build);
            registerSvelteModuleLoader(build, officialBackend, { generate: 'client', dev: development });
          },
        },
      ],
      target: 'browser',
      define: clientBuildDefine(development),
      throw: false,
    });
    expect(result.success).toBe(true);
    return result.outputs[0]!.text();
  }

  const probe = `import { isBrowser, isDev, isServer } from 'mochi-framework';\nglobalThis.__probe = [isDev, isServer, isBrowser];\n`;

  test('isDev carries the build mode into the bundle', async () => {
    expect(await buildProbe('dev', true, probe)).toContain('var isDev = true');
    expect(await buildProbe('prod', false, probe)).toContain('var isDev = false');
  });

  test('the render target flips to the browser', async () => {
    const out = await buildProbe('target', false, probe);
    expect(out).toContain('var isServer = false');
    expect(out).toContain('var isBrowser = true');
  });
});
