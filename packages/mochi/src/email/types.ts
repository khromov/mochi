/**
 * A single transactional message passed to `Mochi.email(...)`. Its body has two independent parts: the HTML part comes
 * from `component` (rendered to inlined HTML) or `html`, with `component` winning when both are set, and the text part
 * from `text`. Omitting `text` alongside an HTML part derives a plain-text alternative so the message stays multipart
 * for deliverability, though supplying your own is recommended.
 */
export interface MochiEmailMessage {
  to: string | string[];
  /** Sender address. Falls back to the configured `email.from`. */
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  /** Pre-rendered HTML part. Ignored when `component` is set. */
  html?: string;
  /** Plain-text part. Recommended alongside HTML; auto-derived from it when omitted. */
  text?: string;
  /** Path to a `.svelte` email template, rendered to HTML with its scoped CSS inlined. */
  component?: string;
  /** Props passed to the `component`. */
  props?: Record<string, unknown>;
  attachments?: MochiEmailAttachment[];
  /** Extra headers merged onto the message. */
  headers?: Record<string, string>;
}

export interface MochiEmailAttachment {
  filename: string;
  content: string | Uint8Array;
  /** MIME type. Inferred by the transport from `filename` when omitted. */
  contentType?: string;
}

/** Outcome of a send. `transport` names whichever handled it, or `'suppressed'` when the `email:message` filter returned `null` and vetoed the send. */
export interface MochiEmailResult {
  transport: 'smtp' | 'custom' | 'log' | 'dev' | 'suppressed';
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
}

/** A message after body-resolution and normalization — `from` filled, address fields coerced to arrays, `html`/`text` finalized — and the exact shape a custom transport's `send` receives. */
export interface ResolvedEmailMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: MochiEmailAttachment[];
  headers?: Record<string, string>;
}

/** SMTP transport settings, forwarded to nodemailer's `createTransport`. */
export interface MochiSmtpConfig {
  host: string;
  /** Default: `465` when `secure`, else `587`. */
  port?: number;
  /** Use implicit TLS on connect. Default: `port === 465`. */
  secure?: boolean;
  auth?: { user: string; pass: string };
  /** Reuse a pooled connection across sends. Default: `false`. */
  pool?: boolean;
  /** Extra TLS options passed through to nodemailer. */
  tls?: Record<string, unknown>;
}

/**
 * Custom-send escape hatch: deliver the resolved message however you like — an HTTP email API such as Resend, SES, or
 * Postmark, or a fake for tests — with no SMTP library loaded on this path. Return a partial result to surface a
 * provider message id; returning nothing yields `{ transport: 'custom' }`.
 */
export type MochiEmailSendFn = (message: ResolvedEmailMessage) => Promise<Omit<MochiEmailResult, 'transport'> | void> | Omit<MochiEmailResult, 'transport'> | void;

/**
 * Pluggable transport, set under `Mochi.serve({ email: { transport } })`. Omitting it selects the default: `dev` in
 * development, capturing into the in-memory outbox at `/_mochi/email`, and `log` in production, which logs the message.
 */
export type MochiEmailTransportConfig = { type: 'log' } | { type: 'dev' } | ({ type: 'smtp' } & MochiSmtpConfig) | { type: 'custom'; send: MochiEmailSendFn };

/** Email configuration; every field is optional, see `resolveEmailOptions` for defaults and `MochiEmailTransportConfig` for what `transport` defaults to. */
export interface MochiEmailOptions {
  /** Default `From` address used when a message omits `from`. */
  from?: string;
  /** Transport to deliver through. Default: `{ type: 'dev' }` in development, `{ type: 'log' }` in production (neither sends). */
  transport?: MochiEmailTransportConfig;
  /**
   * Whether `consoleLogger()` replaces recipient addresses and the subject with `<redacted>` in its `MAIL` lines — both
   * are PII, and `email:error` logs at `warn`, so they reach production logs. Transport, error, and duration are logged
   * regardless. Defaults to `true` in production and `false` in development, and affects only the console formatter:
   * the `email:sent`/`email:error` events always carry the real values.
   */
  filterPii?: boolean;
}

/** Fully-resolved email options with the transport always present. */
export interface ResolvedEmailOptions {
  from?: string;
  transport: MochiEmailTransportConfig;
  filterPii: boolean;
}

/** Thrown for misconfiguration or transport failures surfaced to the caller. */
export class EmailError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmailError';
  }
}
