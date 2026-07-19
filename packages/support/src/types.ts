export type EmailStatus = 'pending' | 'sent' | 'failed';

export type EmailLogEvent = 'queued' | 'requeued' | 'sending' | 'sent' | 'failed';

/** One line of the delivery history shown in the admin panel's email-log popup. */
export interface EmailLogEntry {
  id: number;
  submission_id: number;
  at: number;
  attempt: number;
  event: EmailLogEvent;
  detail: string | null;
}

/** One row of the `submissions` table. Kept out of `db.server.ts` so Svelte components can type against it without importing `bun:sqlite`. */
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
