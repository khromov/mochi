import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

export type EmailStatus = 'pending' | 'sent' | 'failed';

export type EmailLogEvent = 'queued' | 'requeued' | 'sending' | 'sent' | 'failed';

// Types live here so a type-only import is erased before the client build, letting hydrated islands `import type` this without pulling in `bun:sqlite`.
export interface Submission {
  id: number;
  name: string;
  email: string;
  message: string;
  created_at: number;
  handled_at: number | null;
  email_status: EmailStatus;
  email_error: string | null;
  email_sent_at: number | null;
}

// The fields the admin panel's email-log popup renders, shared by both log tables.
export interface DeliveryLogEntry {
  id: number;
  at: number;
  attempt: number;
  event: EmailLogEvent;
  detail: string | null;
}

// One line of the delivery history shown in the admin panel's email-log popup.
export interface EmailLogEntry extends DeliveryLogEntry {
  submission_id: number;
}

export type NewsletterStatus = 'pending' | 'confirmed' | 'unsubscribed';

export interface Subscriber {
  id: number;
  email: string;
  email_key: string;
  status: NewsletterStatus;
  source: string;
  confirm_token: string;
  confirm_expires_at: number;
  unsubscribe_token: string;
  created_at: number;
  requested_at: number;
  confirmed_at: number | null;
  unsubscribed_at: number | null;
  email_status: EmailStatus;
  email_error: string | null;
  email_sent_at: number | null;
}

export interface NewsletterLogEntry extends DeliveryLogEntry {
  subscriber_id: number;
}

// Relative to the package root — the app always runs as `bun --cwd=packages/support`.
// SUPPORT_DB exists so the test suite can point at a temp file instead.
const DB_PATH = process.env.SUPPORT_DB || '.db/support.sqlite';

// bun:sqlite won't create the parent directory.
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    handled_at INTEGER,
    email_status TEXT NOT NULL DEFAULT 'pending',
    email_error TEXT,
    email_sent_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS submissions_by_state ON submissions (handled_at, created_at DESC);

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    event TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS email_log_by_submission ON email_log (submission_id, at);

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    email_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source TEXT NOT NULL DEFAULT '',
    confirm_token TEXT NOT NULL,
    confirm_expires_at INTEGER NOT NULL,
    unsubscribe_token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    requested_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    unsubscribed_at INTEGER,
    email_status TEXT NOT NULL DEFAULT 'pending',
    email_error TEXT,
    email_sent_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS newsletter_by_email ON newsletter_subscribers (email_key);
  CREATE UNIQUE INDEX IF NOT EXISTS newsletter_by_confirm_token ON newsletter_subscribers (confirm_token);
  CREATE UNIQUE INDEX IF NOT EXISTS newsletter_by_unsub_token ON newsletter_subscribers (unsubscribe_token);
  CREATE INDEX IF NOT EXISTS newsletter_by_state ON newsletter_subscribers (status, created_at DESC);

  CREATE TABLE IF NOT EXISTS newsletter_email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    event TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS newsletter_email_log_by_subscriber ON newsletter_email_log (subscriber_id, at);
`);

const insertStmt = db.query<{ id: number }, [string, string, string, number]>('INSERT INTO submissions (name, email, message, created_at) VALUES (?, ?, ?, ?) RETURNING id');
const getStmt = db.query<Submission, [number]>('SELECT * FROM submissions WHERE id = ?');
const listInboxStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NULL ORDER BY created_at DESC');
const listHandledStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NOT NULL ORDER BY handled_at DESC');
const sentStmt = db.query<never, [number, number]>("UPDATE submissions SET email_status = 'sent', email_error = NULL, email_sent_at = ? WHERE id = ?");
const failedStmt = db.query<never, [string, number]>("UPDATE submissions SET email_status = 'failed', email_error = ? WHERE id = ?");
const attemptErrorStmt = db.query<never, [string, number]>('UPDATE submissions SET email_error = ? WHERE id = ?');
const handledStmt = db.query<never, [number | null, number]>('UPDATE submissions SET handled_at = ? WHERE id = ?');
const logInsertStmt = db.query<never, [number, number, number, string, string | null]>('INSERT INTO email_log (submission_id, at, attempt, event, detail) VALUES (?, ?, ?, ?, ?)');
const logAllStmt = db.query<EmailLogEntry, []>('SELECT * FROM email_log ORDER BY at, id');

export function insertSubmission(fields: { name: string; email: string; message: string }): number {
  const row = insertStmt.get(fields.name, fields.email, fields.message, Date.now());
  if (!row) {
    throw new Error('support: INSERT returned no id');
  }
  return row.id;
}

export function getSubmission(id: number): Submission | null {
  return getStmt.get(id);
}

export function listSubmissions(handled: boolean): Submission[] {
  return handled ? listHandledStmt.all() : listInboxStmt.all();
}

export function markEmailSent(id: number): void {
  sentStmt.run(Date.now(), id);
}

// Terminal: the queue has exhausted its retries and won't run the job again.
export function markEmailFailed(id: number, error: string): void {
  failedStmt.run(error.slice(0, 1000), id);
}

// Leaves status `pending` — marking `failed` here would misreport an in-flight delivery, since the queue's durable store still owns a retry.
export function noteEmailAttemptError(id: number, error: string): void {
  attemptErrorStmt.run(error.slice(0, 1000), id);
}

export function setHandled(id: number, handled: boolean): void {
  handledStmt.run(handled ? Date.now() : null, id);
}

export function appendEmailLog(submissionId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
  logInsertStmt.run(submissionId, Date.now(), entry.attempt, entry.event, entry.detail?.slice(0, 1000) ?? null);
}

// Grouped by submission id, oldest first — what the admin panel's log popup renders.
export function emailLogsBySubmission(): Record<number, EmailLogEntry[]> {
  const grouped: Record<number, EmailLogEntry[]> = {};
  for (const entry of logAllStmt.all()) {
    (grouped[entry.submission_id] ??= []).push(entry);
  }
  return grouped;
}

// Only the test suite needs this: Windows keeps the db file locked until the handle closes, blocking temp-dir cleanup.
export function closeDb(): void {
  db.close();
}

const subInsertStmt = db.query<{ id: number }, [string, string, string, string, number, string, number, number]>(
  'INSERT INTO newsletter_subscribers (email, email_key, source, confirm_token, confirm_expires_at, unsubscribe_token, created_at, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
);
const subByKeyStmt = db.query<Subscriber, [string]>('SELECT * FROM newsletter_subscribers WHERE email_key = ?');
const subByIdStmt = db.query<Subscriber, [number]>('SELECT * FROM newsletter_subscribers WHERE id = ?');
const subByConfirmStmt = db.query<Subscriber, [string]>('SELECT * FROM newsletter_subscribers WHERE confirm_token = ?');
const subByUnsubStmt = db.query<Subscriber, [string]>('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token = ?');
const subListStmt = db.query<Subscriber, []>('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC');
const subConfirmStmt = db.query<never, [number, number]>("UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ?, unsubscribed_at = NULL WHERE id = ?");
const subUnsubscribeStmt = db.query<never, [number, number]>("UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?");
const subDeleteStmt = db.query<never, [number]>('DELETE FROM newsletter_subscribers WHERE id = ?');
const subLogDeleteStmt = db.query<never, [number]>('DELETE FROM newsletter_email_log WHERE subscriber_id = ?');
const subReArmStmt = db.query<never, [string, string, number, number, string, number]>(
  "UPDATE newsletter_subscribers SET email = ?, source = ?, status = 'pending', confirmed_at = NULL, unsubscribed_at = NULL, requested_at = ?, confirm_expires_at = ?, confirm_token = ?, email_status = 'pending', email_error = NULL, email_sent_at = NULL WHERE id = ?",
);
const subTokenStmt = db.query<never, [string, number, number, number]>(
  'UPDATE newsletter_subscribers SET confirm_token = ?, confirm_expires_at = ?, requested_at = ? WHERE id = ?',
);
const subSentStmt = db.query<never, [number, number]>("UPDATE newsletter_subscribers SET email_status = 'sent', email_error = NULL, email_sent_at = ? WHERE id = ?");
const subFailedStmt = db.query<never, [string, number]>("UPDATE newsletter_subscribers SET email_status = 'failed', email_error = ? WHERE id = ?");
const subAttemptErrorStmt = db.query<never, [string, number]>('UPDATE newsletter_subscribers SET email_error = ? WHERE id = ?');
const subRequeuedStmt = db.query<never, [number]>("UPDATE newsletter_subscribers SET email_status = 'pending' WHERE id = ?");
const subAttemptStmt = db.query<never, [number, number]>('UPDATE newsletter_subscribers SET requested_at = ? WHERE id = ?');
const subLogInsertStmt = db.query<never, [number, number, number, string, string | null]>(
  'INSERT INTO newsletter_email_log (subscriber_id, at, attempt, event, detail) VALUES (?, ?, ?, ?, ?)',
);
const subLogAllStmt = db.query<NewsletterLogEntry, []>('SELECT * FROM newsletter_email_log ORDER BY at, id');

// Stored raw, not hashed: the admin resend has to reproduce a link that was already mailed out.
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export type SubscribeOutcome = { kind: 'created' | 'resent' | 'resubscribed' | 'already'; id: number } | { kind: 'throttled'; id: number; retryAfterMs: number };

// One row per address forever, its state moved around. Apart from `throttled`,
// callers must render every outcome identically, or the public widget becomes a
// subscriber oracle.
export function requestSubscription(fields: { email: string; source: string }, opts: { cooldownMs: number; ttlMs: number }): SubscribeOutcome {
  const email = fields.email.trim();
  const key = email.toLowerCase();
  const now = Date.now();
  return db.transaction((): SubscribeOutcome => {
    const existing = subByKeyStmt.get(key);
    if (!existing) {
      const row = subInsertStmt.get(email, key, fields.source, newToken(), now + opts.ttlMs, newToken(), now, now);
      if (!row) {
        throw new Error('newsletter: INSERT returned no id');
      }
      return { kind: 'created', id: row.id };
    }
    // Ahead of the confirmed branch, and armed inside it too, so that a throttled
    // answer means only "submitted recently" — were it reachable for pending rows
    // alone, two quick submits would out a confirmed subscriber. Unsubscribing is
    // the one way back in, so it skips the wait; the re-armed row throttles after.
    const elapsed = now - existing.requested_at;
    if (existing.status !== 'unsubscribed' && elapsed < opts.cooldownMs) {
      return { kind: 'throttled', id: existing.id, retryAfterMs: opts.cooldownMs - elapsed };
    }
    if (existing.status === 'confirmed') {
      subAttemptStmt.run(now, existing.id);
      return { kind: 'already', id: existing.id };
    }
    subReArmStmt.run(email, fields.source, now, now + opts.ttlMs, newToken(), existing.id);
    return { kind: existing.status === 'unsubscribed' ? 'resubscribed' : 'resent', id: existing.id };
  })();
}

export function getSubscriber(id: number): Subscriber | null {
  return subByIdStmt.get(id);
}

export function subscriberByConfirmToken(token: string): Subscriber | null {
  return token ? subByConfirmStmt.get(token) : null;
}

export function subscriberByUnsubscribeToken(token: string): Subscriber | null {
  return token ? subByUnsubStmt.get(token) : null;
}

export function listSubscribers(): Subscriber[] {
  return subListStmt.all();
}

export function confirmSubscriber(id: number): void {
  subConfirmStmt.run(Date.now(), id);
}

export function unsubscribeSubscriber(id: number): void {
  subUnsubscribeStmt.run(Date.now(), id);
}

export function deleteSubscriber(id: number): void {
  db.transaction(() => {
    subLogDeleteStmt.run(id);
    subDeleteStmt.run(id);
  })();
}

export function refreshConfirmToken(id: number, ttlMs: number): string {
  const token = newToken();
  const now = Date.now();
  subTokenStmt.run(token, now + ttlMs, now, id);
  subRequeuedStmt.run(id);
  return token;
}

export function markNewsletterEmailSent(id: number): void {
  subSentStmt.run(Date.now(), id);
}

export function markNewsletterEmailFailed(id: number, error: string): void {
  subFailedStmt.run(error.slice(0, 1000), id);
}

export function noteNewsletterAttemptError(id: number, error: string): void {
  subAttemptErrorStmt.run(error.slice(0, 1000), id);
}

export function appendNewsletterLog(subscriberId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
  subLogInsertStmt.run(subscriberId, Date.now(), entry.attempt, entry.event, entry.detail?.slice(0, 1000) ?? null);
}

export function newsletterLogsBySubscriber(): Record<number, NewsletterLogEntry[]> {
  const grouped: Record<number, NewsletterLogEntry[]> = {};
  for (const entry of subLogAllStmt.all()) {
    (grouped[entry.subscriber_id] ??= []).push(entry);
  }
  return grouped;
}
