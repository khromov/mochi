import path from 'node:path';
import { toPosixPath } from '../utils';

/** Directory containing this file (`src/compiler/`). */
const FRAMEWORK_DIR = path.dirname(Bun.fileURLToPath(import.meta.url));
// The framework `src/` root — one level up from `src/compiler/`. Subsystem
// files are addressed relative to it (`utils/log.ts`, `runtime/rateLimit.ts`, …).
const SRC_DIR = path.join(FRAMEWORK_DIR, '..');

// The virtual `mochi-framework` module bodies are authored as plain .js
// template files (real syntax highlighting, no per-line backticks). Their
// build-time dynamic values — the `development` flag and the resolved import
// paths — are written as `__MOCHI_*__` placeholder tokens that `fill()` swaps
// in. Read once at load, mirroring the default-shell.html asset in Mochi.ts.
const SERVER_TEMPLATE = await Bun.file(new URL('./virtual-modules/mochi-env.server.js', import.meta.url)).text();
const CLIENT_TEMPLATE = await Bun.file(new URL('./virtual-modules/mochi-env.client.js', import.meta.url)).text();

function fill(template: string, tokens: Record<string, string>): string {
  let out = template;
  for (const [token, value] of Object.entries(tokens)) {
    out = out.replaceAll(token, value);
  }
  return out;
}

function frameworkFile(...segments: string[]): string {
  return toPosixPath(path.join(SRC_DIR, ...segments));
}

export function renderMochiEnvServer(development: boolean): string {
  return fill(SERVER_TEMPLATE, {
    __MOCHI_DEV__: String(development),
    __MOCHI_LOG__: frameworkFile('utils/log.ts'),
    __MOCHI_GLOBAL_STATE__: frameworkFile('utils/globalState.ts'),
    __MOCHI_DEVALUE__: toPosixPath(Bun.resolveSync('devalue', FRAMEWORK_DIR)),
    __MOCHI_TRAILING_SLASH__: frameworkFile('runtime/trailingSlash.ts'),
    __MOCHI_ISLAND_PROPS__: frameworkFile('islands/islandPropsRegistry.ts'),
    __MOCHI_IS_HYDRATABLE__: frameworkFile('islands/isHydratable.ts'),
    __MOCHI_MITT__: toPosixPath(Bun.resolveSync('mitt', FRAMEWORK_DIR)),
    __MOCHI_CACHE__: frameworkFile('cache/cache.ts'),
    __MOCHI_REQUEST_CACHE__: frameworkFile('runtime/requestCache.ts'),
    __MOCHI_CACHE_STORAGE__: frameworkFile('cache/cache-storage.ts'),
    __MOCHI_IMAGE_API__: frameworkFile('image/imageApi.ts'),
    __MOCHI_LOCAL_FILES__: frameworkFile('runtime/localDirs.ts'),
    __MOCHI_DEFER_API__: frameworkFile('islands/deferInvalidation.ts'),
    __MOCHI_DEFER_REACTIVE__: frameworkFile('islands/deferReloadState.svelte.ts'),
    __MOCHI_ENHANCE_SSR__: frameworkFile('runtime/enhance.ssr.ts'),
    __MOCHI_RATE_LIMIT__: frameworkFile('runtime/rateLimit.ts'),
    // A baked literal, not a module re-export: config.ts computes the path off `import.meta.url`,
    // which inside a compiled SSR chunk would point into the build dir instead of the framework src.
    __MOCHI_PROTECTION_SHELL_PATH__: frameworkFile('templates/ProtectionShell/ProtectionShell.svelte'),
  });
}

export function renderMochiEnvClient(development: boolean, cookiesClientPath: string, enhanceClientPath: string): string {
  return fill(CLIENT_TEMPLATE, {
    __MOCHI_DEV__: String(development),
    __MOCHI_COOKIES_CLIENT__: cookiesClientPath,
    __MOCHI_LOG__: frameworkFile('utils/log.ts'),
    __MOCHI_GLOBAL_STATE__: frameworkFile('utils/globalState.ts'),
    __MOCHI_DEVALUE__: toPosixPath(Bun.resolveSync('devalue', FRAMEWORK_DIR)),
    __MOCHI_TRAILING_SLASH__: frameworkFile('runtime/trailingSlash.ts'),
    __MOCHI_DEFER_API__: frameworkFile('islands/deferInvalidation.ts'),
    __MOCHI_DEFER_REACTIVE__: frameworkFile('islands/deferReloadState.svelte.ts'),
    __MOCHI_ENHANCE_CLIENT__: enhanceClientPath,
  });
}
