/**
 * The acceptance test for multi-node scheduling, and the one thing a single-process
 * unit test cannot establish: with two real OS processes sharing one lease, exactly
 * one of them runs the task, and killing that one hands the work to the other.
 *
 * `SIGKILL` specifically — no shutdown hook runs, so nothing releases the lease.
 * Recovery has to come from the TTL expiring and the survivor re-contesting, which
 * is the failure mode a crashed container actually produces.
 */
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

const root = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-failover-'));
const leaseUrl = `sqlite://${path.join(root, 'lease.db')}`;
const fixture = path.join(import.meta.dir, '__fixtures__', 'task-cluster', 'node.ts');
const LEASE_TTL = 3_000;

const procs: Subprocess[] = [];

afterAll(() => {
  for (const proc of procs) {
    proc.kill(9);
  }
  rmSync(root, { recursive: true, force: true });
});

interface Node {
  proc: Subprocess;
  /** Number of scheduled runs observed so far. */
  runs: () => number;
  sawLeadership: () => boolean;
}

function spawnNode(label: string): Node {
  const outDir = path.join(root, label);
  mkdirSync(outDir, { recursive: true });
  const proc = Bun.spawn(['bun', 'run', fixture, label, outDir, leaseUrl, String(LEASE_TTL)], {
    cwd: path.join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  procs.push(proc);

  let runs = 0;
  let leader = false;
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      for (const line of decoder.decode(chunk).split('\n')) {
        if (line === `${label}:ran`) {
          runs++;
        } else if (line === `${label}:leader:true`) {
          leader = true;
        }
      }
    }
  })();

  return { proc, runs: () => runs, sawLeadership: () => leader };
}

/** Poll until `predicate` holds, or fail loudly with what was actually observed. */
async function waitFor(label: string, timeoutMs: number, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

test('two processes elect one runner, and killing it fails the work over to the survivor', async () => {
  const a = spawnNode('a');
  const b = spawnNode('b');

  // Both are up and contending; exactly one should be doing the work.
  await waitFor('either node to start running the task', 15_000, () => a.runs() > 0 || b.runs() > 0);
  await Bun.sleep(2_500);

  const leader = a.runs() > b.runs() ? a : b;
  const follower = leader === a ? b : a;

  expect(leader.runs()).toBeGreaterThan(1);
  // The whole point: the second node must be idle, not duplicating the work.
  expect(follower.runs()).toBe(0);
  expect(follower.sawLeadership()).toBe(false);

  // SIGKILL: no release, no goodbye — the lease can only expire.
  leader.proc.kill(9);
  const leaderRunsAtDeath = leader.runs();

  await waitFor('the survivor to take over', 20_000, () => follower.runs() > 0);

  expect(follower.sawLeadership()).toBe(true);
  // The dead process stayed dead rather than somehow resuming.
  expect(leader.runs()).toBe(leaderRunsAtDeath);

  // And it keeps running, rather than firing once and stalling.
  const afterTakeover = follower.runs();
  await Bun.sleep(2_500);
  expect(follower.runs()).toBeGreaterThan(afterTakeover);
}, 60_000);
