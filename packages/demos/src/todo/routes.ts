import { existsSync } from 'node:fs';
import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// TodoPage.svelte statically imports ./app.generated.css, so it must exist on
// disk before compileAll bundles the page. In prod it's normally baked by
// scripts/prebuild.ts (fast path: skip here, never loading @tailwindcss/oxide).
// In dev we always run setupTailwind to also attach the rebuild watcher. If the
// file is missing for any reason (e.g. a release image that didn't carry the
// prebuilt CSS), generate it once at startup rather than 500-ing the whole site.
const isDev = process.env.MODE === 'development';
if (isDev || !existsSync('./src/todo/app.generated.css')) {
  const { setupTailwind } = await import('mochi-framework/tailwind');
  await setupTailwind({
    input: './src/todo/app.css',
    output: './src/todo/app.generated.css',
    minify: !isDev,
  });
}

export const routes: Record<string, MochiRouteValue> = {
  '/todo': Mochi.page('./src/todo/TodoPage.svelte'),
};
