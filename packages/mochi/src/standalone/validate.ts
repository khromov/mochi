import { isMochiPage, type MochiPageConfig, type MochiStandaloneOptions } from '../types';
import { logger } from '../utils/log';

/**
 * Shared by the build orchestrator and the in-browser bootstrap, so a bad route table fails the same way whether the
 * app is being built or already running inside a webview.
 */
export function validateStandaloneOptions(options: MochiStandaloneOptions): void {
  if (!options.routes || Object.keys(options.routes).length === 0) {
    throw new Error('Mochi.standalone() requires at least one route in `routes`.');
  }
  for (const [pattern, value] of Object.entries(options.routes)) {
    if (!pattern.startsWith('/')) {
      throw new Error(`Standalone route "${pattern}" must start with "/". Routes are matched against the URL hash (e.g. "#${pattern}" → "/${pattern}").`);
    }
    if (pattern.includes('*')) {
      throw new Error(`Standalone route "${pattern}" uses a wildcard — the hash router only supports static segments and ":param" segments. Use \`notFound\` for a catch-all.`);
    }
    validatePage(`route "${pattern}"`, value);
  }
  if (options.notFound !== undefined) {
    validatePage('`notFound`', options.notFound);
  }
  if (options.loading !== undefined) {
    validatePage('`loading`', options.loading);
    if (options.loading.clientProps !== undefined) {
      throw new Error("The standalone `loading` page cannot declare `clientProps` — it renders synchronously while another route's clientProps resolve.");
    }
  }
}

function validatePage(label: string, value: unknown): asserts value is MochiPageConfig {
  if (!isMochiPage(value)) {
    throw new Error(`Standalone ${label} must be a Mochi.page() — Mochi.api/ws/sse/file and raw Bun route values need a server and cannot run in a standalone app.`);
  }
  if (value.serverProps !== undefined) {
    throw new Error(
      `Standalone ${label} declares \`serverProps\`, but a standalone app has no server render. Use \`clientProps\` (optionally fetching a Mochi.apiDevalue() endpoint).`,
    );
  }
  if (value.actions !== undefined) {
    throw new Error(`Standalone ${label} declares \`actions\`, but form actions need a server. Submit to a Mochi.api() endpoint on your web app instead.`);
  }
  if (value.rateLimit !== undefined) {
    logger.warn(`[mochi] Standalone ${label} declares \`rateLimit\`, which is meaningless client-side — ignored.`);
  }
}
