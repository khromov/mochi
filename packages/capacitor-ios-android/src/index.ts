import { Mochi, silenceInternalRoutes, error } from 'mochi-framework';
import { getTodo, listTodos } from './lib/todos';

const PORT = Number(process.env.PORT) || 3339;

// Simulated backend latency so the standalone app's loading page is actually visible during development.
const simulateLatency = () => new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

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
    // Same TodoPage the standalone app hash-routes to, but SSR'd here with serverProps instead of clientProps.
    '/todos/:id': Mochi.page('./src/TodoPage.svelte', {
      serverProps: (_req, params) => ({ todo: getTodo(Number(params.id)) }),
    }),
    '/api/todos': Mochi.apiDevalue(async () => {
      await simulateLatency();
      return listTodos();
    }),
    '/api/todos/:id': Mochi.apiDevalue(async ({ params }) => {
      await simulateLatency();
      const todo = getTodo(Number(params.id));
      if (todo) {
        return todo;
      }
      error(404, 'No such todo');
    }),
  },
});

console.log('Web app running at http://localhost:' + PORT);
