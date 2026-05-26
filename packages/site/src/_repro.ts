/**
 * Reproduction: bun --hot + Bun.build() EISDIR
 *
 * Demonstrates a Bun bug where `bun --hot` (or `--watch`) causes the
 * second Bun.build() call in a process to fail with EISDIR errors when
 * highlight.js was imported before the build runs.
 *
 * Run from packages/repro/:
 *   bun run repro       → FAILS with EISDIR (uses --hot)
 *   bun run repro:watch → FAILS with EISDIR (uses --watch)
 *   bun run repro:ok    → works fine (no flag)
 *
 * Conditions (all required — removing any one makes the bug disappear):
 *   1. --hot or --watch flag is active
 *   2. highlight.js is imported before Bun.build() runs
 *   3. First Bun.build() uses a Svelte compiler plugin with 34+ entrypoints
 *      that have deep import trees (including highlight.js transitively)
 *   4. Second Bun.build() with target: 'browser' and a Svelte compiler plugin
 *   5. The compiled .svelte files are inside the --hot watch scope
 *      (same directory tree as the entry file)
 *
 * What happens: The second Bun.build() (client bundle, target: browser) reads
 * corrupted internal state from the first build. It tries to resolve
 * highlight.js files that aren't in the client dependency graph, gets EISDIR
 * on those files, and misattributes a node:async_hooks import to highlight.js.
 *
 * Bun version: 1.3.14
 */

// ── Pre-import highlight.js (like routes.ts → highlightCode.ts does) ────────
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('typescript', typescript);

// ── Build using ComponentRegistry ───────────────────────────────────────────
import { ComponentRegistry } from '../../mochi/src/ComponentRegistry';
import { rmSync, readdirSync, existsSync } from 'fs';
import path from 'path';

const SITE_DIR = path.resolve(import.meta.dir, '../../site');
const OUT = path.resolve(SITE_DIR, '.repro-out');
rmSync(OUT, { recursive: true, force: true });

process.chdir(SITE_DIR);

const registry = new ComponentRegistry({
  outDir: OUT,
  development: true,
  svelte: {},
  assetPrefix: '/_mochi',
});

const entrypoints = [
  '/Users/k/Documents/GitHub/yt-subsor/packages/mochi/src/templates/DefaultError.svelte',
  '/Users/k/Documents/GitHub/yt-subsor/packages/mochi/src/templates/ClientStats/ClientStats.svelte',
  '/Users/k/Documents/GitHub/yt-subsor/packages/mochi/src/templates/PageCacheAdmin/PageCacheAdmin.svelte',
  './src/Site.svelte',
  './src/Docs.svelte',
  './src/og/OgPage.svelte',
  './src/demos/api/Api.svelte',
  './src/demos/cache-events/CacheEvents.svelte',
  './src/demos/chat/Chat.svelte',
  './src/demos/cookie-vary-test/CookieVaryTest.svelte',
  './src/demos/cookies/Cookies.svelte',
  './src/demos/data-loading/DataLoading.svelte',
  './src/demos/error/ErrorDemo.svelte',
  './src/demos/error/Error500.svelte',
  './src/demos/error-boundaries/ErrorBoundaries.svelte',
  './src/demos/file-upload/FileUploadDemo.svelte',
  './src/demos/font-loading/FontLoading.svelte',
  './src/demos/form-cancel/FormCancel.svelte',
  './src/demos/form-errors/FormErrors.svelte',
  './src/demos/form-redirects/FormRedirects.svelte',
  './src/demos/form-return-data/FormReturnData.svelte',
  './src/demos/hello-world/HelloWorld.svelte',
  './src/demos/hydratable/Hydratable.svelte',
  './src/demos/hydration/Hydration.svelte',
  './src/demos/island-props/ServerRenderedParent.svelte',
  './src/demos/lazy/Lazy.svelte',
  './src/demos/lazy-server-island/LazyServerIsland.svelte',
  './src/leak-test/LeakIslandPage.svelte',
  './src/demos/login/Login.svelte',
  './src/demos/mdsvex/MdsvexDemo.svelte',
  './src/demos/nested-components/NestedComponents.svelte',
  './src/demos/prop-dedup/PropDedup.svelte',
  './src/demos/reload-form-data/ReloadFormData.svelte',
  './src/demos/server-island/ServerIsland.svelte',
  './src/demos/server-props/ServerProps.svelte',
  './src/demos/shared-state/SharedState.svelte',
  './src/demos/streams/Streams.svelte',
  './src/demos/url/Url.svelte',
  './src/demos/your-first-mochi-app/Hello.svelte',
];

try {
  await registry.compileAll(entrypoints);
  const ssrFiles = readdirSync(path.join(OUT, 'svelte-compile')).length;
  const clientDir = path.join(OUT, 'svelte-client');
  const clientFiles = existsSync(clientDir) ? readdirSync(clientDir).length : 0;
  console.log(`\nSUCCESS — SSR: ${ssrFiles} files, Client: ${clientFiles} files`);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nFAILED:\n${msg.slice(0, 1200)}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
process.exit(0);
