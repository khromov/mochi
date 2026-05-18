import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Build-time CSS generation lives in scripts/prebuild.ts so `compileAll`
// can resolve ./app.generated.css deterministically. Here we only attach
// the dev-mode watcher — dynamically imported so production never loads
// @tailwindcss/oxide's native binding.
if (process.env.MODE === 'development') {
  const { setupTailwind } = await import('mochi-framework/tailwind');
  await setupTailwind({
    input: './src/todo/app.css',
    output: './src/todo/app.generated.css',
    minify: false,
  });
}

export const routes: Record<string, MochiRouteValue> = {
  '/todo': Mochi.page('./src/todo/TodoPage.svelte'),
};
