import { Mochi } from 'mochi-framework';

export interface EmailJob {
  to: string;
}

interface ProcessedEntry {
  to: string;
  at: number;
}

// In-memory so the demo writes no SQLite file into the site working dir; jobs
// don't survive a restart, which is fine for a demo. Pass `dataPath` to persist.
export const emailQueue = Mochi.queue<EmailJob>('demo-emails');

const processed: ProcessedEntry[] = [];
let processedTotal = 0;

Mochi.worker<EmailJob>(
  'demo-emails',
  async (job) => {
    // Simulate the latency of actually sending an email so the UI shows the
    // queued → processing → done transition rather than completing instantly.
    await Bun.sleep(700);
    processed.push({ to: job.data.to, at: Date.now() });
    if (processed.length > 20) {
      processed.shift();
    }
    processedTotal++;
    return { sent: true };
  },
  { concurrency: 2 },
);

export function queueStatus(): { processed: ProcessedEntry[]; processedTotal: number } {
  return { processed: [...processed].reverse(), processedTotal };
}
