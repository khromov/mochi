# @mochi-framework/queue

Minimal SQL-backed job queue for [Bun](https://bun.com). One table, three backends — in-memory, SQLite file, Postgres — all through `Bun.SQL`. Powers `Mochi.queue()` in [mochi-framework](https://www.npmjs.com/package/mochi-framework), usable standalone.

```ts
import { createQueue } from '@mochi-framework/queue';

const emails = createQueue<{ to: string }>('emails', {
  database: 'sqlite://jobs.db', // 'postgres://…', a Bun SQL instance, or omit for in-memory
  concurrency: 2,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  process: async (job) => {
    await send(job.data.to);
  },
  on: {
    failed: (job, error, { willRetry }) => console.warn(job.id, error.message, { willRetry }),
  },
});

await emails.add('send', { to: 'user@example.com' }, { delay: 1000 });
await emails.close();
```

## Semantics

- **Multi-instance safe.** Claims are atomic (`FOR UPDATE SKIP LOCKED` on Postgres, a single atomic `UPDATE` on SQLite), so any number of processes can work one queue; every job runs exactly once.
- **Leases, not locks.** A claimed job holds a lease (`lockDuration`, default 60 s) renewed by a heartbeat while it runs. If the instance dies, the lease expires and another instance reclaims the job — the consumed claim counts as a spent attempt.
- **Outstanding work only.** Completed and terminally-failed jobs are deleted; the table never grows. `jobId` deduplicates while a job is outstanding.
- **Retries with backoff.** `attempts` + `backoff: { type: 'fixed' | 'exponential', delay }` per job or via `defaultJobOptions`.
- **Single-flight recovery.** `tryRecoveryLease()` grants exactly one instance per TTL window the right to run startup recovery against a shared database.
- Job data is `JSON.stringify`'d — payloads must be JSON-serializable.

## License

MIT
