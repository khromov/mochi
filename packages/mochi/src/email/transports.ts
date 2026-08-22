import { recordDevEmail } from './devOutbox';
import { EmailError, type MochiEmailResult, type MochiEmailTransportConfig, type ResolvedEmailMessage } from './types';

/** A transport turns a resolved message into a delivery. */
export interface EmailTransport {
  readonly name: MochiEmailResult['transport'];
  send(message: ResolvedEmailMessage): Promise<MochiEmailResult>;
  /** Release held resources (e.g. an SMTP connection pool). */
  close?(): Promise<void> | void;
}

/** Build the transport instance for a resolved config. Cached by the caller. */
export function buildTransport(config: MochiEmailTransportConfig): EmailTransport {
  switch (config.type) {
    case 'log':
      return new LogTransport();
    case 'dev':
      return new DevTransport();
    case 'custom':
      return new CustomTransport(config.send);
    case 'smtp':
      return new SmtpTransport(config);
  }
}

/**
 * Default transport: reports delivery through the `email:sent` event alone (`transport: 'log'`), which `consoleLogger`
 * surfaces as a warn-level `MAIL … (not sent)` line, visible in production so an unconfigured mailer is obvious.
 * Logging lives in the event subscriber, keeping a send to one line.
 */
class LogTransport implements EmailTransport {
  readonly name = 'log' as const;
  async send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    return { transport: 'log', accepted: message.to };
  }
}

/** Development default: captures each message into the in-memory outbox (`devOutbox.ts`) that the dev-only viewer at `/_mochi/email` renders. */
class DevTransport implements EmailTransport {
  readonly name = 'dev' as const;
  async send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    recordDevEmail(message);
    return { transport: 'dev', accepted: message.to };
  }
}

/** Delivers via a user-supplied send function. No SMTP library is loaded. */
class CustomTransport implements EmailTransport {
  readonly name = 'custom' as const;
  constructor(private readonly sendFn: NonNullable<Extract<MochiEmailTransportConfig, { type: 'custom' }>['send']>) {}
  async send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    const result = (await this.sendFn(message)) ?? {};
    return { transport: 'custom', ...result };
  }
}

type NodemailerTransporter = {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
};

// Typing against a local interface rather than `typeof import('nodemailer')` spares consumers from resolving
// nodemailer's types, which it ships none of, since mochi publishes source they type-check.
type NodemailerModule = { createTransport(opts: unknown): NodemailerTransporter };

/** Delivers over SMTP. nodemailer is imported lazily on first send. */
class SmtpTransport implements EmailTransport {
  readonly name = 'smtp' as const;
  private transporterPromise: Promise<NodemailerTransporter> | undefined;
  private readonly inFlight = new Set<Promise<MochiEmailResult>>();
  private closed = false;

  constructor(private readonly config: Extract<MochiEmailTransportConfig, { type: 'smtp' }>) {}

  // The synchronous `??=` memoizes the in-flight build so concurrent first sends share one transporter instead of each
  // racing past an `await` and leaking its own pool; a failed build stays uncached, so a later send retries the lazy
  // import. `closed` is set synchronously by `close()` before its own await, since a send racing it could otherwise
  // spin up a transporter after `close()` captured the one it's about to close, leaving the new pool open forever.
  private getTransporter(): Promise<NodemailerTransporter> {
    if (this.closed) {
      return Promise.reject(new EmailError('SMTP transport is closed.'));
    }
    return (this.transporterPromise ??= this.buildTransporter().catch((err) => {
      this.transporterPromise = undefined;
      throw err;
    }));
  }

  private async buildTransporter(): Promise<NodemailerTransporter> {
    let nodemailer: NodemailerModule;
    try {
      // Consumers type-check this file, since mochi publishes source, and a *literal* `import('nodemailer')` would make
      // their tsc/svelte-check demand nodemailer's absent types (TS7016). An indirect specifier keeps the runtime
      // import intact while opting this line out of static module-type resolution.
      const nodemailerSpecifier = 'nodemailer';
      nodemailer = (await import(nodemailerSpecifier)) as unknown as NodemailerModule;
    } catch (err) {
      throw new EmailError(
        "Failed to load 'nodemailer' for the SMTP transport. It ships as a dependency of mochi-framework, so this usually means dependencies weren't installed correctly — try reinstalling (`bun install`).",
        { cause: err },
      );
    }
    const { host, port, secure, auth, pool, tls } = this.config;
    const resolvedSecure = secure ?? port === 465;
    return nodemailer.createTransport({
      host,
      port: port ?? (resolvedSecure ? 465 : 587),
      secure: resolvedSecure,
      ...(auth ? { auth } : {}),
      ...(pool ? { pool: true } : {}),
      ...(tls ? { tls } : {}),
    });
  }

  send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    // Track the whole operation (transporter build + sendMail) so close() can
    // drain it before tearing down a pooled connection — otherwise a shutdown
    // mid-send closes the pool out from under an in-flight delivery.
    const op = this.deliver(message);
    this.inFlight.add(op);
    return op.finally(() => this.inFlight.delete(op));
  }

  private async deliver(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    const transporter = await this.getTransporter();
    // `ResolvedEmailMessage`'s fields map 1:1 onto nodemailer's `sendMail`
    // options (from/to/cc/bcc/replyTo/subject/html/text/attachments/headers) and
    // its optional keys are already absent (not undefined), so spread it directly.
    const info = await transporter.sendMail({ ...message });
    return {
      transport: 'smtp',
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    };
  }

  async close(): Promise<void> {
    // Block new pool creation first (synchronously) so `pending` below is
    // guaranteed to be the last transporter that will ever exist.
    this.closed = true;
    const pending = this.transporterPromise;
    this.transporterPromise = undefined;
    if (!pending) {
      return;
    }
    // Let in-flight sends settle before closing so a message mid-delivery isn't
    // killed by the pool teardown.
    await Promise.allSettled(this.inFlight);
    // Await the in-flight build so a pool that finishes constructing mid-shutdown
    // is still closed rather than orphaned. Swallow a build that rejected — there
    // is nothing to close.
    const transporter = await pending.catch(() => undefined);
    transporter?.close();
  }
}
