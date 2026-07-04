import { getEmailRuntime } from './config';
import type { MochiEmailAttachment, ResolvedEmailMessage } from './types';

/** Attachment metadata kept for the viewer — the raw `content` is dropped. */
export interface StoredAttachment {
  filename: string;
  contentType?: string;
  size: number;
}

/**
 * A message captured by the `dev` transport. This is the fully-resolved message
 * (body rendered, addresses arrayified) plus an id and capture time, so the
 * email viewer can show exactly what would have been delivered.
 */
export interface StoredEmail {
  id: string;
  sentAt: number;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: StoredAttachment[];
}

/** Keep the outbox bounded — it lives for the whole dev-server process. */
const MAX_OUTBOX = 100;

let counter = 0;

function attachmentSize(content: MochiEmailAttachment['content']): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
}

/** Capture a resolved message into the in-memory outbox (newest first). */
export function recordDevEmail(message: ResolvedEmailMessage): StoredEmail {
  const runtime = getEmailRuntime();
  const outbox = (runtime.outbox ??= []);
  const stored: StoredEmail = {
    id: `${Date.now().toString(36)}-${(counter++).toString(36)}`,
    sentAt: Date.now(),
    from: message.from,
    to: message.to,
    ...(message.cc ? { cc: message.cc } : {}),
    ...(message.bcc ? { bcc: message.bcc } : {}),
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    subject: message.subject,
    ...(message.html ? { html: message.html } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
    ...(message.attachments ? { attachments: message.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: attachmentSize(a.content) })) } : {}),
  };
  outbox.unshift(stored);
  if (outbox.length > MAX_OUTBOX) {
    outbox.length = MAX_OUTBOX;
  }
  return stored;
}

/** All captured messages, newest first. */
export function getDevEmails(): StoredEmail[] {
  return getEmailRuntime().outbox ?? [];
}

/** One captured message by id, or `undefined`. */
export function getDevEmail(id: string): StoredEmail | undefined {
  return getDevEmails().find((e) => e.id === id);
}

/** Empty the outbox. */
export function clearDevOutbox(): void {
  const runtime = getEmailRuntime();
  if (runtime.outbox) {
    runtime.outbox.length = 0;
  }
}
