import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

export async function waitFor(cond: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await Bun.sleep(10);
  }
}

/** A sqlite file inside the package tree (never /tmp — repo convention), removable via cleanup(). */
export function tempSqliteDb(): { url: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.queue-test-'));
  return {
    url: `sqlite://${path.join(dir, 'jobs.db')}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
