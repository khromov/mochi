import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

// The db path must be set before `./db.server` is evaluated, hence the dynamic import.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-newsletter-purge-'));
process.env.SUPPORT_DB = path.join(outDir, 'support.sqlite');

const { closeDb, confirmSubscriber, getSubscriber, purgeExpiredPendingSubscribers, requestSubscription } = await import('./db.server');

afterAll(() => {
  closeDb();
  rmSync(outDir, { recursive: true, force: true });
});

const emailOf = (id: number): string | undefined => getSubscriber(id)?.email;

// Expiry was previously only noticed when someone visited a dead confirm link, so an address that never confirmed
// stayed on file forever. The nightly `newsletter-purge-expired` cron job calls this.
describe('purgeExpiredPendingSubscribers', () => {
  test('deletes pending sign-ups past their confirmation window and leaves live ones alone', () => {
    const stale = requestSubscription({ email: 'stale@example.com', source: 'test' }, { cooldownMs: 0, ttlMs: 1 });
    const fresh = requestSubscription({ email: 'fresh@example.com', source: 'test' }, { cooldownMs: 0, ttlMs: 60_000 });

    const removed = purgeExpiredPendingSubscribers(Date.now() + 1000);

    expect(removed).toBe(1);
    expect(emailOf(stale.id!)).toBeUndefined();
    expect(emailOf(fresh.id!)).toBe('fresh@example.com');
  });

  test('never deletes a confirmed subscriber, however long ago the window closed', () => {
    const confirmed = requestSubscription({ email: 'confirmed@example.com', source: 'test' }, { cooldownMs: 0, ttlMs: 1 });
    confirmSubscriber(confirmed.id!);

    purgeExpiredPendingSubscribers(Date.now() + 1_000_000);

    expect(emailOf(confirmed.id!)).toBe('confirmed@example.com');
  });

  test('reports zero when nothing has expired', () => {
    expect(purgeExpiredPendingSubscribers(0)).toBe(0);
  });
});
