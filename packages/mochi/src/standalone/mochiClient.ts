import type {
  MochiApiConfig,
  MochiApiHandler,
  MochiDevalueApiHandler,
  MochiFileConfig,
  MochiFileResolver,
  MochiPageConfig,
  MochiPageOptions,
  MochiSseConfig,
  MochiSseHandler,
  MochiStandaloneOptions,
  MochiWsConfig,
  MochiWsHandlers,
} from '../types';
import type { MochiRateLimitOptions } from '../runtime/rateLimit';
import { validateStandaloneOptions } from './validate';
import { startHashRouter } from './router';

const MOUNT_TARGET_ID = 'mochi-app';

function serverOnly(name: string): () => never {
  return () => {
    throw new Error(`${name} is only available on the server — a standalone app runs entirely in the browser.`);
  };
}

let booted = false;

/**
 * The `Mochi` an app entry sees inside a standalone client bundle (exported through the virtual `mochi-framework`
 * module). Descriptor factories stay pure data so shared route modules keep importing cleanly; `standalone()` becomes
 * the actual in-browser bootstrap, and everything that needs a live server throws.
 */
export const Mochi = {
  page(componentPath: string, config?: MochiPageOptions): MochiPageConfig {
    return {
      __mochiPage: true,
      componentPath,
      serverProps: config?.serverProps,
      actions: config?.actions,
      rateLimit: config?.rateLimit,
      clientProps: config?.clientProps,
    };
  },

  async standalone(options: MochiStandaloneOptions): Promise<void> {
    if (booted) {
      throw new Error('Mochi.standalone() has already been called. Only one instance is allowed.');
    }
    booted = true;
    validateStandaloneOptions(options);
    let target = document.getElementById(MOUNT_TARGET_ID);
    if (!target) {
      target = document.createElement('div');
      target.id = MOUNT_TARGET_ID;
      document.body.appendChild(target);
    }
    const router = startHashRouter({ routes: options.routes, notFound: options.notFound, loading: options.loading, target });
    await router.ready;
  },

  // Descriptor factories mirror the real class as pure data, so a shared route module building web-app routes at
  // module scope doesn't break the client bundle just by being imported. Standalone validation still rejects these
  // descriptors in the standalone routes map.
  api(handler: MochiApiHandler, config?: { rateLimit?: MochiRateLimitOptions | false }): MochiApiConfig {
    return { __mochiApi: true, handler, rateLimit: config?.rateLimit };
  },
  apiDevalue(handler: MochiDevalueApiHandler, config?: { rateLimit?: MochiRateLimitOptions | false }): MochiApiConfig {
    return { __mochiApi: true, handler: handler as unknown as MochiApiHandler, rateLimit: config?.rateLimit };
  },
  ws<T = unknown>(handlers: MochiWsHandlers<T>): MochiWsConfig {
    return { __mochiWs: true, handlers: handlers as MochiWsHandlers<unknown> };
  },
  sse(handler: MochiSseHandler): MochiSseConfig {
    return { __mochiSse: true, handler };
  },
  file(source: string | MochiFileResolver): MochiFileConfig {
    return { __mochiFile: true, source };
  },

  serve: serverOnly('Mochi.serve()'),
  queue: serverOnly('Mochi.queue()'),
  getQueue: serverOnly('Mochi.getQueue()'),
  worker: serverOnly('Mochi.worker()'),
  boss: serverOnly('Mochi.boss()'),
  email: serverOnly('Mochi.email()'),
  stop: serverOnly('Mochi.stop()'),
};
