/**
 * Cross-process leader election. A single atomic statement rather than a write-then-read-back check:
 * `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` picks the winner inside the database, leaving
 * no window between "I wrote it" and "I confirmed it" for a peer to slip through.
 *
 * The WHERE clause encodes the three ways to win: we already hold it (renewal), the holder's heartbeat
 * is older than the TTL, or we are a strictly newer build (so a rolling deploy hands over immediately
 * instead of idling a whole TTL — unknown build times on either side fall back to TTL expiry).
 */
import { createSqlDriver, timestampColumn, toNumber, type SqlDriver } from '../sql/driver';

export interface LeaseRecord {
  name: string;
  owner: string;
  buildId: string | null;
  buildTime: number | null;
  acquiredAt: number;
  heartbeatAt: number;
}

export interface LeaseClaim {
  owner: string;
  buildId: string | null;
  buildTime: number | null;
  /** Current time, epoch ms. Injected rather than read internally so tests are deterministic. */
  now: number;
  /** A holder whose heartbeat is older than `now - ttl` has lost the lease. */
  ttl: number;
}

export interface LeaseResult {
  acquired: boolean;
  /** Who holds it now — us when `acquired`, otherwise the incumbent (or `null` if it vanished mid-check). */
  holder: LeaseRecord | null;
}

export interface TaskLeaseStore {
  tryAcquire(claim: LeaseClaim): Promise<LeaseResult>;
  /** Refresh our heartbeat. `false` means we were preempted and must stand down. */
  renew(owner: string, now: number): Promise<boolean>;
  /** Give up the lease if we still hold it, so a peer takes over at once rather than waiting out the TTL. */
  release(owner: string): Promise<void>;
  read(): Promise<LeaseRecord | null>;
  close(): Promise<void>;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface SqlLeaseStoreOptions {
  /** `sqlite://…` (or a path ending in `.db`/`.sqlite`) or `postgres://…`. */
  url: string;
  /** Table name. Default `mochi_lease`. Interpolated into DDL, so it must be a plain identifier. */
  table?: string;
  /** Lease row key, so several apps can share one database. Default `mochi:tasks:leader`. */
  name?: string;
}

interface LeaseRow {
  name: string;
  owner: string;
  build_id: string | null;
  build_time: unknown;
  acquired_at: unknown;
  heartbeat_at: unknown;
}

function toRecord(row: LeaseRow): LeaseRecord {
  return {
    name: row.name,
    owner: row.owner,
    buildId: row.build_id,
    buildTime: toNumber(row.build_time),
    acquiredAt: toNumber(row.acquired_at) ?? 0,
    heartbeatAt: toNumber(row.heartbeat_at) ?? 0,
  };
}

export class SqlLeaseStore implements TaskLeaseStore {
  private driver: SqlDriver;
  private table: string;
  private name: string;
  private ready?: Promise<void>;

  constructor(options: SqlLeaseStoreOptions) {
    this.table = options.table ?? 'mochi_lease';
    if (!IDENTIFIER.test(this.table)) {
      throw new Error(`SqlLeaseStore: table name "${this.table}" is not a plain SQL identifier.`);
    }
    this.name = options.name ?? 'mochi:tasks:leader';
    this.driver = createSqlDriver(options.url);
  }

  async tryAcquire(claim: LeaseClaim): Promise<LeaseResult> {
    await this.init();
    const rows = await this.driver.query<{ owner: string }>(
      `INSERT INTO ${this.table} (name, owner, build_id, build_time, acquired_at, heartbeat_at)
       VALUES ($name, $owner, $buildId, $buildTime, $now, $now)
       ON CONFLICT (name) DO UPDATE SET
         owner = excluded.owner,
         build_id = excluded.build_id,
         build_time = excluded.build_time,
         acquired_at = excluded.acquired_at,
         heartbeat_at = excluded.heartbeat_at
       WHERE ${this.table}.owner = excluded.owner
          OR ${this.table}.heartbeat_at < $staleBefore
          OR (excluded.build_time IS NOT NULL AND ${this.table}.build_time IS NOT NULL AND excluded.build_time > ${this.table}.build_time)
       RETURNING owner`,
      {
        name: this.name,
        owner: claim.owner,
        buildId: claim.buildId,
        buildTime: claim.buildTime,
        now: claim.now,
        staleBefore: claim.now - claim.ttl,
      },
    );

    const acquired = rows[0]?.owner === claim.owner;
    return { acquired, holder: await this.read() };
  }

  async renew(owner: string, now: number): Promise<boolean> {
    await this.init();
    // Scoped to `owner`, so a node preempted while it slept learns about it here (zero rows) instead of overwriting the new leader's row.
    const rows = await this.driver.query<{ owner: string }>(`UPDATE ${this.table} SET heartbeat_at = $now WHERE name = $name AND owner = $owner RETURNING owner`, {
      now,
      name: this.name,
      owner,
    });
    return rows.length > 0;
  }

  async release(owner: string): Promise<void> {
    await this.init();
    await this.driver.query(`DELETE FROM ${this.table} WHERE name = $name AND owner = $owner`, { name: this.name, owner });
  }

  async read(): Promise<LeaseRecord | null> {
    await this.init();
    const rows = await this.driver.query<LeaseRow>(`SELECT name, owner, build_id, build_time, acquired_at, heartbeat_at FROM ${this.table} WHERE name = $name`, {
      name: this.name,
    });
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      const ts = timestampColumn(this.driver.dialect);
      await this.driver.query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
           name TEXT PRIMARY KEY,
           owner TEXT NOT NULL,
           build_id TEXT,
           build_time ${ts},
           acquired_at ${ts} NOT NULL,
           heartbeat_at ${ts} NOT NULL
         )`,
      );
    })();
    return this.ready;
  }
}

/** Coordinates nothing across processes — it exists so the single-process path runs the same election code as production, not a second untested branch. */
export class MemoryLeaseStore implements TaskLeaseStore {
  private record: LeaseRecord | null = null;
  private readonly name: string;

  constructor(name = 'mochi:tasks:leader') {
    this.name = name;
  }

  async tryAcquire(claim: LeaseClaim): Promise<LeaseResult> {
    const held = this.record;
    const expired = held !== null && held.heartbeatAt < claim.now - claim.ttl;
    const newerBuild = held !== null && claim.buildTime !== null && held.buildTime !== null && claim.buildTime > held.buildTime;
    if (held === null || held.owner === claim.owner || expired || newerBuild) {
      this.record = {
        name: this.name,
        owner: claim.owner,
        buildId: claim.buildId,
        buildTime: claim.buildTime,
        acquiredAt: claim.now,
        heartbeatAt: claim.now,
      };
      return { acquired: true, holder: this.record };
    }
    return { acquired: false, holder: held };
  }

  async renew(owner: string, now: number): Promise<boolean> {
    if (this.record === null || this.record.owner !== owner) {
      return false;
    }
    this.record = { ...this.record, heartbeatAt: now };
    return true;
  }

  async release(owner: string): Promise<void> {
    if (this.record?.owner === owner) {
      this.record = null;
    }
  }

  async read(): Promise<LeaseRecord | null> {
    return this.record;
  }

  async close(): Promise<void> {
    this.record = null;
  }
}
