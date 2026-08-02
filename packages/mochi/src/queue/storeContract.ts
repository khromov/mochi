import { expect } from 'bun:test';
import type { MochiBetterQueueStore } from './store';

type Task = { v: string };

function call<V>(run: (cb: (err: unknown, value?: V) => void) => void): Promise<V | undefined> {
  return new Promise((resolve, reject) => run((err, value) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(value))));
}

/**
 * Asserts the full better-queue store contract against a fresh store — shared by the sqlite and postgres suites so both
 * backends prove the exact semantics the memory store ships with.
 */
export async function runStoreContract(makeStore: () => MochiBetterQueueStore<Task> | Promise<MochiBetterQueueStore<Task>>): Promise<void> {
  const store = await makeStore();

  expect(await call<number>((cb) => store.connect(cb))).toBe(0);

  await call((cb) => store.putTask('a', { v: 'a' }, 0, cb));
  await call((cb) => store.putTask('b', { v: 'b' }, 0, cb));
  await call((cb) => store.putTask('urgent', { v: 'urgent' }, 10, cb));
  await call((cb) => store.putTask('c', { v: 'c' }, 0, cb));

  // Upsert replaces the payload without duplicating or re-ordering the row.
  await call((cb) => store.putTask('b', { v: 'b2' }, 0, cb));
  expect(await call<Task>((cb) => store.getTask('b', cb))).toEqual({ v: 'b2' });
  expect(await call<Task>((cb) => store.getTask('missing', cb))).toBeUndefined();

  // takeFirstN claims priority-first, then FIFO, under a fresh lock.
  const lock1 = await call<string>((cb) => store.takeFirstN(2, cb));
  expect(lock1).toBeString();
  const batch1 = await call<Record<string, Task>>((cb) => store.getLock(lock1!, cb));
  expect(Object.keys(batch1!).sort()).toEqual(['a', 'urgent']);

  // Locked tasks leave the queued set: invisible to getTask, visible to getRunningTasks.
  expect(await call<Task>((cb) => store.getTask('urgent', cb))).toBeUndefined();
  const running = await call<Record<string, Record<string, Task>>>((cb) => store.getRunningTasks(cb));
  expect(Object.keys(running!)).toEqual([lock1!]);
  expect(Object.keys(running![lock1!]!).sort()).toEqual(['a', 'urgent']);

  // A second take claims the remainder under a different lock; takeLastN takes newest-first.
  const lock2 = await call<string>((cb) => store.takeLastN(1, cb));
  expect(lock2).not.toBe(lock1);
  const batch2 = await call<Record<string, Task>>((cb) => store.getLock(lock2!, cb));
  expect(Object.keys(batch2!)).toEqual(['c']);

  // putTask re-queues a task even while a lock exists elsewhere (the retry path).
  await call((cb) => store.putTask('a', { v: 'a-retry' }, 0, cb));
  expect(await call<Task>((cb) => store.getTask('a', cb))).toEqual({ v: 'a-retry' });

  // releaseLock discards the claimed tasks — but not the re-queued 'a'.
  await call((cb) => store.releaseLock(lock1!, cb));
  expect(await call<Record<string, Task>>((cb) => store.getLock(lock1!, cb))).toEqual({});
  expect(await call<Task>((cb) => store.getTask('a', cb))).toEqual({ v: 'a-retry' });
  expect(await call<Task>((cb) => store.getTask('urgent', cb))).toBeUndefined();

  await call((cb) => store.releaseLock(lock2!, cb));
  expect(await call<Record<string, Record<string, Task>>>((cb) => store.getRunningTasks(cb))).toEqual({});

  // Queued now: b (added 2nd), a (re-queued last). FIFO respects re-queue order.
  const lock3 = await call<string>((cb) => store.takeFirstN(1, cb));
  expect(Object.keys((await call<Record<string, Task>>((cb) => store.getLock(lock3!, cb)))!)).toEqual(['b']);
  await call((cb) => store.releaseLock(lock3!, cb));

  await call((cb) => store.deleteTask('a', cb));
  expect(await call<Task>((cb) => store.getTask('a', cb))).toBeUndefined();

  // An empty take yields a lock over nothing rather than an error.
  const emptyLock = await call<string>((cb) => store.takeFirstN(5, cb));
  expect(await call<Record<string, Task>>((cb) => store.getLock(emptyLock!, cb))).toEqual({});

  await call((cb) => (store.close ? store.close(cb) : cb(null)));
}
