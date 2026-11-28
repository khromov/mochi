import { compileTailwind } from 'mochi-framework/tailwind';

// Build-time Tailwind CSS generation, run before `mochi-framework build` so
// `compileAll` can resolve ./styles/app.generated.css deterministically. The
// dev-mode watcher lives in src/index.ts (dynamically imported so production
// never loads @tailwindcss/oxide's native binding).
await compileTailwind({
  input: './src/styles/app.css',
  output: './src/styles/app.generated.css',
  minify: true,
});
