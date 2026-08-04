import { SQL } from 'bun';

export type Dialect = 'sqlite' | 'postgres';

export interface JobRow {
  queue: string;
  id: string;
  name: string;
  data: string;
  status: string;
  priority: number | bigint | string;
  run_at: number | bigint | string;
  attempts_made: number | bigint | string;
  max_attempts: number | bigint | string;
  backoff_type: string | null;
  backoff_delay: number | bigint | string | null;
  lease_token: string | null;
  lease_expires_at: number | bigint | string | null;
  created_at: number | bigint | string;
}

export interface NewJobRow {
  queue: string;
  id: string;
  name: string;
  data: string;
  status: 'pending';
  priority: number;
  run_at: number;
  attempts_made: number;
  max_attempts: number;
  backoff_type: string | null;
  backoff_delay: number | null;
  lease_token: null;
  lease_expires_at: null;
  created_at: number;
}

export function resolveDatabase(database?: string | SQL): { sql: SQL; owned: boolean } {
  if (database !== undefined && typeof database !== 'string') {
    return { sql: database, owned: false };
  }
  return { sql: new SQL(database ?? 'sqlite://:memory:'), owned: true };
}

export function dialectOf(sql: SQL): Dialect {
  const adapter = sql.options.adapter;
  if (adapter === 'sqlite' || adapter === 'postgres') {
    return adapter;
  }
  throw new Error(`@mochi-framework/queue: unsupported database adapter "${adapter}" — use sqlite, postgres, or omit \`database\` for in-memory.`);
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS mochi_jobs (
    queue            TEXT NOT NULL,
    id               TEXT NOT NULL,
    name             TEXT NOT NULL,
    data             TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    priority         BIGINT NOT NULL DEFAULT 0,
    run_at           BIGINT NOT NULL,
    attempts_made    BIGINT NOT NULL DEFAULT 0,
    max_attempts     BIGINT NOT NULL DEFAULT 1,
    backoff_type     TEXT,
    backoff_delay    BIGINT,
    lease_token      TEXT,
    lease_expires_at BIGINT,
    created_at       BIGINT NOT NULL,
    PRIMARY KEY (queue, id)
  )`,
  `CREATE INDEX IF NOT EXISTS mochi_jobs_claim_idx ON mochi_jobs (queue, status, priority, run_at)`,
  `CREATE INDEX IF NOT EXISTS mochi_jobs_lease_idx ON mochi_jobs (queue, status, lease_expires_at)`,
  `CREATE TABLE IF NOT EXISTS mochi_queue_meta (
    queue               TEXT PRIMARY KEY,
    recover_lease_until BIGINT NOT NULL DEFAULT 0
  )`,
];

// Memoized per SQL instance: several queues sharing one handle bootstrap once, and on
// Postgres concurrent CREATE TABLE IF NOT EXISTS can race into duplicate-key errors.
const bootstrapped = new WeakMap<SQL, Promise<void>>();

export function ensureSchema(sql: SQL, dialect: Dialect): Promise<void> {
  let ready = bootstrapped.get(sql);
  if (!ready) {
    ready = (async () => {
      if (dialect === 'sqlite') {
        await sql.unsafe(`PRAGMA journal_mode = WAL`);
        await sql.unsafe(`PRAGMA busy_timeout = 5000`);
      }
      for (const statement of DDL) {
        await sql.unsafe(statement);
      }
    })();
    bootstrapped.set(sql, ready);
  }
  return ready;
}

/**
 * Atomically claim up to `limit` due jobs: pending rows whose `run_at` has arrived, plus
 * active rows whose lease expired (a crashed or stalled instance). Claiming spends an
 * attempt and stamps the fencing token every later mutation must present.
 */
export async function claimJobs(sql: SQL, dialect: Dialect, queue: string, limit: number, token: string, now: number, lockDuration: number): Promise<JobRow[]> {
  const leaseUntil = now + lockDuration;
  if (dialect === 'postgres') {
    return await sql`
      WITH picked AS (
        SELECT queue, id FROM mochi_jobs
        WHERE queue = ${queue} AND (
          (status = 'pending' AND run_at <= ${now})
          OR (status = 'active' AND lease_expires_at <= ${now})
        )
        ORDER BY priority ASC, run_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE mochi_jobs j
      SET status = 'active', lease_token = ${token}, lease_expires_at = ${leaseUntil}, attempts_made = j.attempts_made + 1
      FROM picked p WHERE j.queue = p.queue AND j.id = p.id
      RETURNING j.*`;
  }
  // A single UPDATE is atomic under sqlite's writer lock — no locking clause exists or is needed.
  return await sql`
    UPDATE mochi_jobs
    SET status = 'active', lease_token = ${token}, lease_expires_at = ${leaseUntil}, attempts_made = attempts_made + 1
    WHERE (queue, id) IN (
      SELECT queue, id FROM mochi_jobs
      WHERE queue = ${queue} AND (
        (status = 'pending' AND run_at <= ${now})
        OR (status = 'active' AND lease_expires_at <= ${now})
      )
      ORDER BY priority ASC, run_at ASC, id ASC
      LIMIT ${limit}
    )
    RETURNING *`;
}

export async function insertJobs(sql: SQL, rows: NewJobRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await sql`INSERT INTO mochi_jobs ${sql(rows)} ON CONFLICT (queue, id) DO NOTHING`;
}

/** True if the row was still ours (token matched) and is now gone. */
export async function deleteJob(sql: SQL, queue: string, id: string, token: string): Promise<boolean> {
  const rows: Array<{ id: string }> = await sql`DELETE FROM mochi_jobs WHERE queue = ${queue} AND id = ${id} AND lease_token = ${token} RETURNING id`;
  return rows.length > 0;
}

/** Put a failed job back to pending for a later attempt; true if the token still held. */
export async function retryJob(sql: SQL, queue: string, id: string, token: string, runAt: number): Promise<boolean> {
  const rows: Array<{ id: string }> = await sql`
    UPDATE mochi_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, run_at = ${runAt}
    WHERE queue = ${queue} AND id = ${id} AND lease_token = ${token} RETURNING id`;
  return rows.length > 0;
}

export async function renewLease(sql: SQL, queue: string, id: string, token: string, leaseUntil: number): Promise<void> {
  await sql`UPDATE mochi_jobs SET lease_expires_at = ${leaseUntil} WHERE queue = ${queue} AND id = ${id} AND lease_token = ${token}`;
}

/** Release a claim that was never dispatched (claimed mid-shutdown) without spending its attempt. */
export async function unclaimJob(sql: SQL, queue: string, id: string, token: string): Promise<void> {
  await sql`
    UPDATE mochi_jobs SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, attempts_made = attempts_made - 1
    WHERE queue = ${queue} AND id = ${id} AND lease_token = ${token}`;
}

/** Earliest moment anything in this queue becomes due: pending `run_at` or active lease expiry. */
export async function nextWakeAt(sql: SQL, queue: string): Promise<number | null> {
  const rows: Array<{ wake_at: number | bigint | string | null }> = await sql`
    SELECT MIN(CASE WHEN status = 'pending' THEN run_at ELSE lease_expires_at END) AS wake_at
    FROM mochi_jobs WHERE queue = ${queue}`;
  const value = rows[0]?.wake_at;
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Single-flight recovery claim: the guarded upsert returns a row only when the insert won
 * or the previous lease had expired, so exactly one instance sees `true` per TTL window.
 */
export async function tryRecoveryLease(sql: SQL, queue: string, now: number, ttl: number): Promise<boolean> {
  const until = now + ttl;
  const rows: Array<{ queue: string }> = await sql`
    INSERT INTO mochi_queue_meta (queue, recover_lease_until) VALUES (${queue}, ${until})
    ON CONFLICT (queue) DO UPDATE SET recover_lease_until = ${until}
    WHERE mochi_queue_meta.recover_lease_until <= ${now}
    RETURNING queue`;
  return rows.length > 0;
}

export async function releaseRecoveryLease(sql: SQL, queue: string): Promise<void> {
  await sql`UPDATE mochi_queue_meta SET recover_lease_until = 0 WHERE queue = ${queue}`;
}
