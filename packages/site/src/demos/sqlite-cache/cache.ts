import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MochiCache, SqliteStorage } from 'mochi-framework';
import { delay } from '../../components/utils';

// File-backed so cached entries outlive the process — restart the dev server
// and the same computedAt timestamp is still served, read straight from disk.
export const dbPath = join(tmpdir(), 'mochi-sqlite-cache-demo.sqlite');

// SQLite stores text/blobs, not objects, so each entry is JSON-encoded on the
// way in and decoded on the way out.
export const reportCache = new MochiCache({
  storage: new SqliteStorage(dbPath),
  serialize: JSON.stringify,
  deserialize: JSON.parse,
  minTimeToStale: 15_000,
  maxTimeToLive: 60_000,
});

export interface Report {
  computedAt: string;
}

export function getReport() {
  return reportCache.fetchWithStatus<Report>('report', async () => {
    await delay(200);
    return { computedAt: new Date().toISOString() };
  });
}
