import { Mochi, silenceInternalRoutes, error } from 'mochi-framework';
import { getTodo } from './lib/todos';

const PORT = Number(process.env.PORT) || 3339;

await Mochi.serve({
  port: PORT,
  development: process.env.MODE === 'development',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  // The standalone app calls this API from its own origin (dev server or Capacitor webview), so /api/* must allow CORS.
  handle: async ({ event, resolve }) => {
    const response = await resolve(event);
    if (event.url.pathname.startsWith('/api/')) {
      response.headers.set('Access-Control-Allow-Origin', '*');
    }
    return response;
  },
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
    '/api/todos/:id': Mochi.apiDevalue(({ params }) => {
      const todo = getTodo(Number(params.id));
      if (todo) {
        return todo;
      }
      error(404, 'No such todo');
    }),
  },
});

console.log('Web app running at http://localhost:' + PORT);
