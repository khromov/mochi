import { Mochi, sequence, silenceInternalRoutes } from 'mochi-framework';
import type { MochiEmailTransportConfig } from 'mochi-framework';
import { analytics } from 'mochi-shared';
import { routes } from './routes';
import { adminAuth } from './adminAuth';
import { SUPPORT_EMAIL_QUEUE, supportEmailQueue } from './jobs.server';

const PORT = Number(process.env.PORT) || 3336;
const DEVELOPMENT = process.env.MODE === 'development';
const ORIGIN = process.env.MOCHI_ORIGIN || `http://localhost:${PORT}`;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || undefined;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' ? true : process.env.SMTP_SECURE === 'false' ? false : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;

// SMTP_HOST is the switch: absent means no transport at all, so the framework
// default applies (dev outbox in development). Never build a half-configured
// smtp transport out of a partial env.
const smtp: MochiEmailTransportConfig | undefined = SMTP_HOST
  ? {
      type: 'smtp',
      host: SMTP_HOST,
      ...(SMTP_PORT ? { port: SMTP_PORT } : {}),
      ...(SMTP_SECURE === undefined ? {} : { secure: SMTP_SECURE }),
      ...(SMTP_USER && SMTP_PASSWORD ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {}),
    }
  : undefined;

await Mochi.serve({
  port: PORT,
  development: DEVELOPMENT,
  htmlShell: './src/shell.html',
  trailingSlash: 'always',
  proxy: { origin: ORIGIN },
  // Auth first, so an unauthorised /admin hit is never counted as a pageview.
  handle: sequence(adminAuth, analytics),
  queues: { [SUPPORT_EMAIL_QUEUE]: supportEmailQueue },
  email: {
    from: process.env.SMTP_FROM || 'Mochi Support Form <support@mochi.fast>',
    transport: smtp,
  },
  captcha: {
    bits: Number(process.env.CAPTCHA_POW_BITS) || 16,
    minAgeMs: Number.isFinite(Number(process.env.CAPTCHA_MIN_AGE_MS)) ? Number(process.env.CAPTCHA_MIN_AGE_MS) : 2000,
    store: process.env.CAPTCHA_NONCE_STORE === 'sqlite' ? 'sqlite' : 'memory',
    ...(process.env.CAPTCHA_NONCE_DB ? { storePath: process.env.CAPTCHA_NONCE_DB } : {}),
  },
  eventHooks: {
    // Boot-only by design, not a module-level throw: `mochi-framework build`
    // imports this entry to read the serve() options, and the build runs without
    // SMTP env — a top-level throw would break `docker build` and `bun run build`.
    // The build's capturing stub halts at the serve() call, before hooks run.
    'mochi:init': () => {
      if (DEVELOPMENT) {
        return;
      }
      if (!process.env.ADMIN_PASSWORD) {
        throw new Error('ADMIN_PASSWORD is not set. Without it /admin/ rejects every request. See packages/support/.env.example.');
      }
      if (!smtp) {
        throw new Error(
          'SMTP_HOST is not set. Without it the support form would accept submissions and silently drop them on the `log` transport. See packages/support/.env.example.',
        );
      }
      if (!process.env.MOCHI_ORIGIN) {
        throw new Error(
          "MOCHI_ORIGIN is not set. Mochi's CSRF check rejects every form POST in production unless proxy.origin is configured, so the form would 403. Set it to the public origin, e.g. https://support.mochi.fast.",
        );
      }
    },
  },
  filters: {
    'consoleLogger:line': silenceInternalRoutes,
  },
  routes,
});

console.log('Server running at ' + ORIGIN);
