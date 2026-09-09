import { Mochi, silenceInternalRoutes } from 'mochi-framework';

const PORT = Number(process.env.PORT) || 3335;

await Mochi.serve({
  port: PORT,
  development: process.env.NODE_ENV === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes: {
    '/': Mochi.page('./src/HelloWorld.svelte'),
    '/health': Mochi.api(() => Response.json({ status: 'ok' })),
  },
});

console.log('Server running at http://localhost:' + PORT);
