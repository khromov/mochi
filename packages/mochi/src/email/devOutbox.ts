import { getEmailRuntime } from './config';
import type { MochiEmailAttachment, ResolvedEmailMessage } from './types';

/**
 * Attachment metadata plus its raw bytes, so the dev viewer can open the file. `content` is server-only: the viewer
 * route strips it from the `selected` projection, keeping the bytes out of the page, and the download route reads it
 * back via `getDevAttachment`.
 */
export interface StoredAttachment {
  filename: string;
  contentType?: string;
  size: number;
  content?: string | Uint8Array;
}

/** A message captured by the `dev` transport: the fully-resolved message plus an id and capture time, so the viewer shows exactly what would have been delivered. */
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

export type DevEmailListener = (email: StoredEmail) => void;

/**
 * Subscribe to dev-outbox captures — `Mochi.serve()` uses it to push a "new email" signal carrying the captured id over
 * the live-reload socket. Listeners live on the shared runtime, so a duplicated module copy reaches the same set.
 */
export function onDevEmailRecorded(listener: DevEmailListener): () => void {
  const set = (getEmailRuntime().recordListeners ??= new Set());
  set.add(listener);
  return () => set.delete(listener);
}

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
    ...(message.attachments
      ? { attachments: message.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: attachmentSize(a.content), content: a.content })) }
      : {}),
  };
  outbox.unshift(stored);
  if (outbox.length > MAX_OUTBOX) {
    outbox.length = MAX_OUTBOX;
  }
  // A throwing listener must never break capture.
  runtime.recordListeners?.forEach((listener) => {
    try {
      listener(stored);
    } catch {
      /* ignore listener errors */
    }
  });
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

/** One captured attachment (with its raw bytes) by message id + index, for the viewer's download route. */
export function getDevAttachment(id: string, index: number): StoredAttachment | undefined {
  return getDevEmail(id)?.attachments?.[index];
}

/** Empty the outbox. */
export function clearDevOutbox(): void {
  const runtime = getEmailRuntime();
  if (runtime.outbox) {
    runtime.outbox.length = 0;
  }
}
