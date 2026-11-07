import { existsSync } from 'node:fs';
import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// `TodoPage.svelte` statically imports `./app.generated.css`, so it must exist before `compileAll` bundles the page.
// Dev always runs `setupTailwind` for the rebuild watcher; otherwise this generates it once if missing rather than 500-ing the site.
const isDev = process.env.NODE_ENV === 'development';
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
