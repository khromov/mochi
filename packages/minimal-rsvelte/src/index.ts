import { Mochi, silenceInternalRoutes } from 'mochi-framework';

const PORT = Number(process.env.PORT) || 3337;

await Mochi.serve({
  port: PORT,
  svelteCompiler: 'rsvelte',
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes: {
    '/': Mochi.page('./src/HelloWorld.svelte'),
  },
});

console.log('Server running at http://localhost:' + PORT);
