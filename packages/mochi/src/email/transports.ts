import { logger } from '../log';
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
    case 'custom':
      return new CustomTransport(config.send);
    case 'smtp':
      return new SmtpTransport(config);
  }
}

/**
 * Default transport: logs a one-line summary and sends nothing. Uses `warn` so
 * the "not sent" notice is visible in production too (where the default log
 * level is `warn`), surfacing an unconfigured mailer instead of silently
 * dropping mail.
 */
class LogTransport implements EmailTransport {
  readonly name = 'log' as const;
  async send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    logger.warn(`email(log): to=${message.to.join(', ')} subject=${JSON.stringify(message.subject)} — not sent (no email transport configured)`);
    return { transport: 'log', accepted: message.to };
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

/** Delivers over SMTP. nodemailer is imported lazily on first send. */
class SmtpTransport implements EmailTransport {
  readonly name = 'smtp' as const;
  private transporter: NodemailerTransporter | undefined;

  constructor(private readonly config: Extract<MochiEmailTransportConfig, { type: 'smtp' }>) {}

  private async getTransporter(): Promise<NodemailerTransporter> {
    if (this.transporter) {
      return this.transporter;
    }
    let nodemailer: typeof import('nodemailer');
    try {
      nodemailer = await import('nodemailer');
    } catch {
      throw new EmailError("The 'nodemailer' package is required for the SMTP transport. Install it with `bun add nodemailer`.");
    }
    const { host, port, secure, auth, pool, tls } = this.config;
    const resolvedSecure = secure ?? port === 465;
    this.transporter = nodemailer.createTransport({
      host,
      port: port ?? (resolvedSecure ? 465 : 587),
      secure: resolvedSecure,
      ...(auth ? { auth } : {}),
      ...(pool ? { pool: true } : {}),
      ...(tls ? { tls } : {}),
    }) as unknown as NodemailerTransporter;
    return this.transporter;
  }

  async send(message: ResolvedEmailMessage): Promise<MochiEmailResult> {
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from: message.from,
      to: message.to,
      ...(message.cc ? { cc: message.cc } : {}),
      ...(message.bcc ? { bcc: message.bcc } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      ...(message.html ? { html: message.html } : {}),
      ...(message.text ? { text: message.text } : {}),
      ...(message.attachments ? { attachments: message.attachments } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    });
    return {
      transport: 'smtp',
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    };
  }

  close(): void {
    this.transporter?.close();
    this.transporter = undefined;
  }
}
