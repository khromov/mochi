import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

export type EmailStatus = 'pending' | 'sending' | 'sent' | 'failed';

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

  CREATE TABLE IF NOT EXISTS newsletter_email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    event TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS newsletter_email_log_by_subscriber ON newsletter_email_log (subscriber_id, at);

  DROP INDEX IF EXISTS newsletter_by_state;
`);

// One implementation of the email_status/email_error/email_sent_at columns + their log table, so the submission and
// newsletter delivery paths can't drift apart the way subReArmStmt and refreshConfirmToken already had.
function createDeliveryLog<TLog extends DeliveryLogEntry>(config: { table: string; logTable: string; fk: string }) {
  const { table, logTable, fk } = config;
  const sentStmt = db.query<never, [number, number]>(`UPDATE ${table} SET email_status = 'sent', email_error = NULL, email_sent_at = ? WHERE id = ?`);
  const failedStmt = db.query<never, [string, number]>(`UPDATE ${table} SET email_status = 'failed', email_error = ? WHERE id = ?`);
  const attemptErrorStmt = db.query<never, [string, number]>(`UPDATE ${table} SET email_status = 'pending', email_error = ? WHERE id = ?`);
  const requeueStmt = db.query<never, [number]>(`UPDATE ${table} SET email_status = 'pending', email_error = NULL WHERE id = ?`);
  const claimStmt = db.query<never, [number]>(`UPDATE ${table} SET email_status = 'sending' WHERE id = ? AND email_status = 'pending'`);
  const logInsertStmt = db.query<never, [number, number, number, string, string | null]>(`INSERT INTO ${logTable} (${fk}, at, attempt, event, detail) VALUES (?, ?, ?, ?, ?)`);
  const logAllStmt = db.query<TLog, []>(`SELECT * FROM ${logTable} ORDER BY at, id`);
  return {
    markSent(id: number): void {
      sentStmt.run(Date.now(), id);
    },
    // Terminal: the queue has exhausted its retries and won't run the job again.
    markFailed(id: number, error: string): void {
      failedStmt.run(error.slice(0, 1000), id);
    },
    // Non-terminal: back to `pending` (not `failed`, which would misreport an in-flight delivery the queue still owns),
    // which also releases a `claim()` so the retry can re-acquire it.
    noteAttemptError(id: number, error: string): void {
      attemptErrorStmt.run(error.slice(0, 1000), id);
    },
    requeue(id: number): void {
      requeueStmt.run(id);
    },
    // Atomically move `pending` → `sending` so only one job ever mails a given confirmation; a duplicate or superseded
    // job finds a non-`pending` row and returns false.
    claim(id: number): boolean {
      return claimStmt.run(id).changes === 1;
    },
    appendLog(entityId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
      logInsertStmt.run(entityId, Date.now(), entry.attempt, entry.event, entry.detail?.slice(0, 1000) ?? null);
    },
    logsByEntity(): Record<number, TLog[]> {
      const grouped: Record<number, TLog[]> = {};
      for (const entry of logAllStmt.all()) {
        const key = (entry as unknown as Record<string, unknown>)[fk] as number;
        (grouped[key] ??= []).push(entry);
      }
      return grouped;
    },
  };
}

const submissionDelivery = createDeliveryLog<EmailLogEntry>({ table: 'submissions', logTable: 'email_log', fk: 'submission_id' });
const newsletterDelivery = createDeliveryLog<NewsletterLogEntry>({ table: 'newsletter_subscribers', logTable: 'newsletter_email_log', fk: 'subscriber_id' });

const insertStmt = db.query<{ id: number }, [string, string, string, number]>('INSERT INTO submissions (name, email, message, created_at) VALUES (?, ?, ?, ?) RETURNING id');
const getStmt = db.query<Submission, [number]>('SELECT * FROM submissions WHERE id = ?');
const listInboxStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NULL ORDER BY created_at DESC');
const listHandledStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NOT NULL ORDER BY handled_at DESC');
const handledStmt = db.query<never, [number | null, number]>('UPDATE submissions SET handled_at = ? WHERE id = ?');

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
  submissionDelivery.markSent(id);
}

export function markEmailFailed(id: number, error: string): void {
  submissionDelivery.markFailed(id, error);
}

export function noteEmailAttemptError(id: number, error: string): void {
  submissionDelivery.noteAttemptError(id, error);
}

export function setHandled(id: number, handled: boolean): void {
  handledStmt.run(handled ? Date.now() : null, id);
}

export function appendEmailLog(submissionId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
  submissionDelivery.appendLog(submissionId, entry);
}

// Grouped by submission id, oldest first — what the admin panel's log popup renders.
export function emailLogsBySubmission(): Record<number, EmailLogEntry[]> {
  return submissionDelivery.logsByEntity();
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
const subExpiredIdsStmt = db.query<{ id: number }, [number]>("SELECT id FROM newsletter_subscribers WHERE status = 'pending' AND confirm_expires_at < ?");
const subReArmStmt = db.query<never, [string, string, number, number, string, number]>(
  "UPDATE newsletter_subscribers SET email = ?, source = ?, status = 'pending', confirmed_at = NULL, unsubscribed_at = NULL, requested_at = ?, confirm_expires_at = ?, confirm_token = ?, email_status = 'pending', email_error = NULL, email_sent_at = NULL WHERE id = ?",
);
const subTokenStmt = db.query<never, [string, number, number, number]>(
  'UPDATE newsletter_subscribers SET confirm_token = ?, confirm_expires_at = ?, requested_at = ? WHERE id = ?',
);
const subAttemptStmt = db.query<never, [number, number]>('UPDATE newsletter_subscribers SET requested_at = ? WHERE id = ?');

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

/**
 * Delete pending sign-ups whose confirmation window has closed. Expiry is otherwise only noticed when someone visits a
 * dead token, so without this every unconfirmed address is retained forever — a row nobody may ever look at again.
 * Returns how many were removed.
 */
export function purgeExpiredPendingSubscribers(now: number = Date.now()): number {
  const expired = subExpiredIdsStmt.all(now);
  if (expired.length === 0) {
    return 0;
  }
  db.transaction(() => {
    for (const { id } of expired) {
      subLogDeleteStmt.run(id);
      subDeleteStmt.run(id);
    }
  })();
  return expired.length;
}

export function refreshConfirmToken(id: number, ttlMs: number): string {
  const token = newToken();
  const now = Date.now();
  subTokenStmt.run(token, now + ttlMs, now, id);
  newsletterDelivery.requeue(id);
  return token;
}

// Returns false when another job already claimed (or completed) this confirmation — see createDeliveryLog.claim.
export function claimNewsletterSend(id: number): boolean {
  return newsletterDelivery.claim(id);
}

export function markNewsletterEmailSent(id: number): void {
  newsletterDelivery.markSent(id);
}

export function markNewsletterEmailFailed(id: number, error: string): void {
  newsletterDelivery.markFailed(id, error);
}

export function noteNewsletterAttemptError(id: number, error: string): void {
  newsletterDelivery.noteAttemptError(id, error);
}

export function appendNewsletterLog(subscriberId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
  newsletterDelivery.appendLog(subscriberId, entry);
}

export function newsletterLogsBySubscriber(): Record<number, NewsletterLogEntry[]> {
  return newsletterDelivery.logsByEntity();
}
