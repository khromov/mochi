import { Mochi, silenceInternalRoutes } from 'mochi-framework';
import { routes } from './routes';

const PORT = Number(process.env.PORT) || 3335;

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
