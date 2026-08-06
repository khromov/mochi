import { load } from 'varlock';
import { patchGlobalConsole } from 'varlock/patch-console';
import { ENV } from 'varlock/env';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

// Parse + validate `.env.schema` before any code reads config; throws on a schema violation.
await load();

// Redact every `@sensitive` value from console output for the rest of the process.
patchGlobalConsole();

await Mochi.serve({
  port: ENV.DEMO_API_PORT,
  development: ENV.DEMO_APP_ENV === 'development',
  routes,
});
