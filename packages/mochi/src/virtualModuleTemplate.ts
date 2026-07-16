import path from 'node:path';
import { toPosixPath } from './utils';

/** Directory containing the framework's own .ts/.svelte source files. */
const FRAMEWORK_DIR = path.dirname(Bun.fileURLToPath(import.meta.url));

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
  return toPosixPath(path.join(FRAMEWORK_DIR, ...segments));
}

export function renderMochiEnvServer(development: boolean): string {
  return fill(SERVER_TEMPLATE, {
    __MOCHI_DEV__: String(development),
    __MOCHI_LOG__: frameworkFile('log.ts'),
    __MOCHI_DEVALUE__: toPosixPath(Bun.resolveSync('devalue', FRAMEWORK_DIR)),
    __MOCHI_TRAILING_SLASH__: frameworkFile('trailingSlash.ts'),
    __MOCHI_ISLAND_PROPS__: frameworkFile('islandPropsRegistry.ts'),
    __MOCHI_MITT__: toPosixPath(Bun.resolveSync('mitt', FRAMEWORK_DIR)),
    __MOCHI_CACHE__: frameworkFile('cache.ts'),
    __MOCHI_CACHE_STORAGE__: frameworkFile('cache-storage.ts'),
    __MOCHI_IMAGE_API__: frameworkFile('image/imageApi.ts'),
    __MOCHI_ENHANCE_SSR__: frameworkFile('enhance.ssr.ts'),
    __MOCHI_RATE_LIMIT__: frameworkFile('rateLimit.ts'),
  });
}

export function renderMochiEnvClient(development: boolean, cookiesClientPath: string, enhanceClientPath: string): string {
  return fill(CLIENT_TEMPLATE, {
    __MOCHI_DEV__: String(development),
    __MOCHI_COOKIES_CLIENT__: cookiesClientPath,
    __MOCHI_LOG__: frameworkFile('log.ts'),
    __MOCHI_DEVALUE__: toPosixPath(Bun.resolveSync('devalue', FRAMEWORK_DIR)),
    __MOCHI_TRAILING_SLASH__: frameworkFile('trailingSlash.ts'),
    __MOCHI_ENHANCE_CLIENT__: enhanceClientPath,
  });
}
