/**
 * Queue recovery re-enqueues stranded work, so an N-instance deploy running it in
 * every process re-enqueues that work N times. These cover the lease that makes
 * it single-flight — including that a store outage degrades toward recovering
 * rather than skipping.
 */
import { afterAll, afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { closeAllQueueResources, createQueue, runQueueRecovery } from './queue';
import { SqlLeaseStore, type TaskLeaseStore } from './tasks/lease';
import { markStartupMilestone, resetStartupMilestones } from './lifecycle';
import { setLogLevel } from './utils/log';

setLogLevel('error');

const dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-queue-lease-test-'));
const leaseUrl = `sqlite://${path.join(dir, 'lease.db')}`;
const stores: TaskLeaseStore[] = [];

let counter = 0;
const uniqueName = (): string => `qr-${counter++}`;

function track<T extends TaskLeaseStore>(store: T): T {
  stores.push(store);
  return store;
}

afterEach(async () => {
  resetStartupMilestones();
  await closeAllQueueResources();
});

afterAll(async () => {
  await Promise.allSettled(stores.map((s) => s.close()));
  rmSync(dir, { recursive: true, force: true });
});

/** Register a queue whose `recover` just counts, and return the entries shape serve() passes. */
function queueWithRecover(name: string, onRecover: () => void) {
  createQueue(name, async () => undefined);
  markStartupMilestone('mochi:queuesMounted');
  return [[name, { recover: () => void onRecover() }]] as Array<[string, { recover?: () => void }]>;
}

test('without a lease, every process recovers — the duplication this exists to prevent', async () => {
  let recovered = 0;
  const entries = queueWithRecover(uniqueName(), () => recovered++);

  await runQueueRecovery(entries);
  await runQueueRecovery(entries);

  expect(recovered).toBe(2);
});

test('with a shared lease, only the first process recovers', async () => {
  let recovered = 0;
  const entries = queueWithRecover(uniqueName(), () => recovered++);
  // Two independent connections to one file — two processes, as far as SQLite cares.
  const nodeA = track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:a' }));
  const nodeB = track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:a' }));

  await runQueueRecovery(entries, { store: nodeA });
  await runQueueRecovery(entries, { store: nodeB });

  expect(recovered).toBe(1);
});

test('the lease is not released on completion, so a peer booting right after still skips', async () => {
  let recovered = 0;
  const entries = queueWithRecover(uniqueName(), () => recovered++);
  const store = track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:held' }));

  await runQueueRecovery(entries, { store });
  // The row must survive the run — releasing it would invite the next process to
  // redo the work we just did.
  expect(await store.read()).not.toBeNull();

  await runQueueRecovery(entries, { store: track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:held' })) });
  expect(recovered).toBe(1);
});

test('once the window lapses, a genuine restart recovers again', async () => {
  let recovered = 0;
  const entries = queueWithRecover(uniqueName(), () => recovered++);
  const store = track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:window' }));

  // A 1ms window stands in for "long enough ago to be a real restart".
  await runQueueRecovery(entries, { store, window: 1 });
  await Bun.sleep(20);
  await runQueueRecovery(entries, { store: track(new SqlLeaseStore({ url: leaseUrl, name: 'recovery:window' })), window: 1 });

  expect(recovered).toBe(2);
});

test('an unreachable lease store recovers anyway rather than silently skipping', async () => {
  let recovered = 0;
  const entries = queueWithRecover(uniqueName(), () => recovered++);
  const broken: TaskLeaseStore = {
    tryAcquire: () => Promise.reject(new Error('store unavailable')),
    renew: () => Promise.resolve(false),
    release: () => Promise.resolve(),
    read: () => Promise.resolve(null),
    close: () => Promise.resolve(),
  };

  await runQueueRecovery(entries, { store: broken });

  // Not knowing whether a peer has it is not a reason to drop stranded jobs:
  // re-running recovery is recoverable, skipping it is not.
  expect(recovered).toBe(1);
});

test('queues without a recover() never touch the lease store', async () => {
  createQueue(uniqueName(), async () => undefined);
  markStartupMilestone('mochi:queuesMounted');
  let asked = false;
  const spy: TaskLeaseStore = {
    tryAcquire: () => {
      asked = true;
      return Promise.resolve({ acquired: true, holder: null });
    },
    renew: () => Promise.resolve(false),
    release: () => Promise.resolve(),
    read: () => Promise.resolve(null),
    close: () => Promise.resolve(),
  };

  await runQueueRecovery([['no-recover', {}]], { store: spy });

  expect(asked).toBe(false);
});
