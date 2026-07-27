import { getMochiConfig } from '../mochiConfig';
import type { ComponentRegistry } from '../compiler/ComponentRegistry';
import type { StoredEmail } from './devOutbox';
import type { EmailTransport } from './transports';
import type { MochiEmailOptions, ResolvedEmailOptions } from './types';

/** Resolve email options. Without a `transport`, development defaults to `dev` and production to `log`, so an unconfigured mailer never silently delivers. */
export function resolveEmailOptions(opts: MochiEmailOptions | undefined, development: boolean): ResolvedEmailOptions {
  const o = opts ?? {};
  return {
    from: o.from,
    transport: o.transport ?? { type: development ? 'dev' : 'log' },
    filterPii: o.filterPii ?? !development,
  };
}

export interface EmailRuntime {
  options: ResolvedEmailOptions;
  /** Built lazily on first send, then cached (holds the SMTP pool if any). */
  transport?: EmailTransport;
  /** The live compile cache, assigned by `Mochi.serve()`; needed to render Svelte email templates. */
  registry?: ComponentRegistry;
  /** In-memory outbox populated by the `dev` transport; read by the email viewer. */
  outbox?: StoredEmail[];
  /** Dev-only listeners notified when the `dev` transport captures a message (see `onDevEmailRecorded`). */
  recordListeners?: Set<(email: StoredEmail) => void>;
}

// Pinned on globalThis like `__mochi_config__`: compiled Svelte components each get their own bundled copy of this
// module yet must share one resolved config, one transport instance, and one registry.
const GLOBAL_KEY = '__mochi_email_runtime__';

export function getEmailRuntime(): EmailRuntime {
  const g = globalThis as unknown as Record<string, unknown>;
  let runtime = g[GLOBAL_KEY] as EmailRuntime | undefined;
  if (!runtime) {
    const { options } = getMochiConfig();
    const development = (options.development as boolean | undefined) ?? true;
    runtime = { options: resolveEmailOptions(options.email as MochiEmailOptions | undefined, development) };
    g[GLOBAL_KEY] = runtime;
  }
  return runtime;
}

/**
 * Close a pooled SMTP transport and drop the cached instance so a subsequent
 * send rebuilds it. Called on server shutdown. No-op for log/custom transports.
 */
export async function closeEmailTransport(): Promise<void> {
  const g = globalThis as unknown as Record<string, unknown>;
  const runtime = g[GLOBAL_KEY] as EmailRuntime | undefined;
  if (runtime?.transport?.close) {
    await runtime.transport.close();
  }
  if (runtime) {
    runtime.transport = undefined;
  }
}
