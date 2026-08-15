import { Mochi } from 'mochi-framework';
import { fetchTodo } from './lib/todosClient';

const PORT = Number(process.env.PORT) || 3338;

// The standalone entry: same components and isomorphic code as src/index.ts, but built as a static SPA
// (dist/index.html + JS/CSS) that Capacitor can package. `bun src/app.ts` writes the build; the dev script
// (MODE=development) serves it with live reload instead.
await Mochi.standalone({
  port: PORT,
  development: process.env.MODE === 'development',
  htmlShell: './src/app-shell.html',
  routes: {
    '/': Mochi.page('./src/Home.svelte'),
    '/todos/:id': Mochi.page('./src/TodoPage.svelte', {
      clientProps: async (params) => ({ todo: await fetchTodo(Number(params.id)) }),
    }),
  },
  notFound: Mochi.page('./src/NotFound.svelte'),
});
