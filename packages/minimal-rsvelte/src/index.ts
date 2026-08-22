import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import HelloWorld from './HelloWorld.svelte';

const PORT = Number(process.env.PORT) || 3337;

await Mochi.serve({
  port: PORT,
  svelteCompiler: 'rsvelte',
  development: process.env.MODE === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes: {
    '/': Mochi.page(HelloWorld),
  },
});

console.log('Server running at http://localhost:' + PORT);
