import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import type { EmailLogEntry, EmailLogEvent, Submission } from './types';

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
`);

const insertStmt = db.query<{ id: number }, [string, string, string, number]>('INSERT INTO submissions (name, email, message, created_at) VALUES (?, ?, ?, ?) RETURNING id');
const getStmt = db.query<Submission, [number]>('SELECT * FROM submissions WHERE id = ?');
const listInboxStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NULL ORDER BY created_at DESC');
const listHandledStmt = db.query<Submission, []>('SELECT * FROM submissions WHERE handled_at IS NOT NULL ORDER BY handled_at DESC');
const sentStmt = db.query<never, [number, number]>("UPDATE submissions SET email_status = 'sent', email_error = NULL, email_sent_at = ? WHERE id = ?");
const failedStmt = db.query<never, [string, number]>("UPDATE submissions SET email_status = 'failed', email_error = ? WHERE id = ?");
const handledStmt = db.query<never, [number | null, number]>('UPDATE submissions SET handled_at = ? WHERE id = ?');
const pendingStmt = db.query<{ id: number }, []>("SELECT id FROM submissions WHERE email_status = 'pending' ORDER BY created_at");
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

export function markEmailFailed(id: number, error: string): void {
  failedStmt.run(error.slice(0, 1000), id);
}

export function setHandled(id: number, handled: boolean): void {
  handledStmt.run(handled ? Date.now() : null, id);
}

export function appendEmailLog(submissionId: number, entry: { attempt: number; event: EmailLogEvent; detail?: string }): void {
  logInsertStmt.run(submissionId, Date.now(), entry.attempt, entry.event, entry.detail?.slice(0, 1000) ?? null);
}

/** Grouped by submission id, oldest first — what the admin panel's log popup renders. */
export function emailLogsBySubmission(): Record<number, EmailLogEntry[]> {
  const grouped: Record<number, EmailLogEntry[]> = {};
  for (const entry of logAllStmt.all()) {
    (grouped[entry.submission_id] ??= []).push(entry);
  }
  return grouped;
}

/** Jobs live only in memory, so a restart strands every unsent row — index.ts re-enqueues these on boot. */
export function pendingSubmissionIds(): number[] {
  return pendingStmt.all().map((row) => row.id);
}
