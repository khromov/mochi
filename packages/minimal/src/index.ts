import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const PORT = Number(process.env.PORT) || 3335;

const routes: Record<string, MochiRouteValue> = {
  '/': Mochi.page('./src/HelloWorld.svelte'),
};

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});

console.log('Server running at http://localhost:' + PORT);
