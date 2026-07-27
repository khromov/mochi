import { afterEach, describe, expect, test } from 'bun:test';
import { mochiEvents } from '../events';
import { markStartupMilestone, resetStartupMilestones } from '../lifecycle';
import { clearTasks, createInternalTask, createTask, drainTasks, getTask, hasClusterTasks, listTasks, setTaskGate, startTasks, stopAllTasks, stopClusterTasks } from './tasks';

afterEach(() => {
  clearTasks();
});

async function capture<K extends 'task:run' | 'task:error' | 'task:skipped'>(name: K, fn: () => Promise<void> | void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const handler = (payload: unknown) => void seen.push(payload);
  mochiEvents.on(name, handler as never);
  try {
    await fn();
  } finally {
    mochiEvents.off(name, handler as never);
  }
  return seen;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('task declaration', () => {
  test('requires exactly one of cron or at', () => {
    expect(() => createTask('none', { run: () => {} })).toThrow(/exactly one of/);
    expect(() => createTask('both', { cron: '* * * * *', at: new Date(), run: () => {} })).toThrow(/exactly one of/);
  });

  test('rejects an unparseable one-off date when it is scheduled', () => {
    createTask('bad-at', { at: 'not-a-date', run: () => {} });
    expect(() => startTasks(true)).toThrow(/not a valid date/);
  });

  test('re-registering a name replaces rather than stacks', () => {
    createTask('dup', { cron: '* * * * *', run: () => {} });
    createTask('dup', { cron: '* * * * *', run: () => {} });
    expect(listTasks().filter((t) => t.name === 'dup')).toHaveLength(1);
  });

  test('scope defaults to cluster', () => {
    const handle = createTask('scoped', { cron: '* * * * *', run: () => {} });
    expect(handle.scope).toBe('cluster');
    expect(createTask('local', { cron: '* * * * *', scope: 'node', run: () => {} }).scope).toBe('node');
  });

  test('rejects runOnStart on a one-off', () => {
    expect(() => createTask('once-more', { at: new Date(Date.now() + 60_000), runOnStart: true, run: () => {} })).toThrow(/runOnStart/);
  });

  test('the "mochi:" prefix is reserved for the framework', () => {
    expect(() => createTask('mochi:image-sweep', { cron: '* * * * *', run: () => {} })).toThrow(/reserved/);
    // The framework's own registration path bypasses the guard.
    expect(createInternalTask('mochi:image-sweep', { cron: '* * * * *', run: () => {} }).name).toBe('mochi:image-sweep');
  });

  test('an invalid cron pattern names the task it came from', () => {
    createTask('garbled', { cron: 'not a cron', run: () => {} });
    expect(() => startTasks(true)).toThrow(/Mochi\.task\("garbled"\): invalid schedule/);
  });
});

describe('hasClusterTasks', () => {
  test('false when nothing is registered', () => {
    expect(hasClusterTasks()).toBe(false);
  });

  test('false when every task is node-scoped — nothing to elect a leader for', () => {
    createTask('local-a', { cron: '* * * * *', scope: 'node', run: () => {} });
    createTask('local-b', { cron: '* * * * *', scope: 'node', run: () => {} });
    expect(hasClusterTasks()).toBe(false);
  });

  test('true once a default-scope task exists', () => {
    createTask('local', { cron: '* * * * *', scope: 'node', run: () => {} });
    createTask('shared', { cron: '* * * * *', run: () => {} });
    expect(hasClusterTasks()).toBe(true);
  });
});

describe('getTask', () => {
  test('explains that tasks are not mounted yet before serve() ran', () => {
    expect(() => getTask('missing')).toThrow(/not mounted yet/);
  });

  test('resolves a declared task', () => {
    createTask('known', { cron: '* * * * *', run: () => {} });
    expect(getTask('known').name).toBe('known');
  });

  test('once mounted, an empty registry means "you declared none" rather than "too early"', () => {
    markStartupMilestone('mochi:tasksMounted');
    try {
      expect(() => getTask('missing')).toThrow(/no tasks were declared/);
      createTask('other', { cron: '* * * * *', run: () => {} });
      // With something registered, the message becomes a typo hint listing what exists.
      expect(() => getTask('missing')).toThrow(/Declared tasks: other/);
    } finally {
      resetStartupMilestones();
    }
  });
});

describe('running a task', () => {
  test('trigger() runs it now and reports a task:run', async () => {
    let ran = 0;
    const handle = createTask('manual', {
      cron: '0 0 1 1 *',
      run: () => {
        ran++;
      },
    });

    const events = await capture('task:run', () => handle.trigger());
    expect(ran).toBe(1);
    expect(events[0]).toMatchObject({ task: 'manual', scope: 'cluster' });
  });

  test('a throwing task is contained: reported, handed to on.error, never rethrown', async () => {
    const seen: string[] = [];
    const handle = createTask('boom', {
      cron: '0 0 1 1 *',
      run: () => {
        throw new Error('kaboom');
      },
      on: { error: (error, context) => void seen.push(`${context.name}:${error.message}`) },
    });

    const events = await capture('task:error', async () => {
      // Resolves rather than rejects — a failing cron must not take the server down.
      await expect(handle.trigger()).resolves.toBeUndefined();
    });
    expect(events[0]).toMatchObject({ task: 'boom', error: 'kaboom' });
    expect(seen).toEqual(['boom:kaboom']);
  });

  test('an on.error handler that itself throws does not escape', async () => {
    const handle = createTask('boom2', {
      cron: '0 0 1 1 *',
      run: () => {
        throw new Error('inner');
      },
      on: {
        error: () => {
          throw new Error('handler blew up');
        },
      },
    });
    await expect(handle.trigger()).resolves.toBeUndefined();
  });

  test('isBusy reflects an in-flight run, and drainTasks waits for it', async () => {
    const gate = deferred();
    const handle = createTask('slow', { cron: '0 0 1 1 *', run: () => gate.promise });

    const run = handle.trigger();
    expect(handle.isBusy()).toBe(true);

    let drained = false;
    const drain = drainTasks(5_000).then(() => {
      drained = true;
    });
    // Still in flight, so the drain must not have resolved yet.
    await Bun.sleep(10);
    expect(drained).toBe(false);

    gate.resolve();
    await run;
    await drain;
    expect(drained).toBe(true);
    expect(handle.isBusy()).toBe(false);
  });

  test('drainTasks gives up on a run that outlives its budget', async () => {
    const stuck = deferred();
    const handle = createTask('stuck', { cron: '0 0 1 1 *', run: () => stuck.promise });
    void handle.trigger();

    const started = performance.now();
    await drainTasks(50);
    // Returned on the budget rather than hanging on the never-settling run.
    expect(performance.now() - started).toBeLessThan(2_000);
    stuck.resolve();
  });
});

describe('scheduling', () => {
  test('a cron task actually fires on its schedule', async () => {
    const fired = deferred();
    createTask('ticker', { cron: '* * * * * *', run: () => fired.resolve() });

    startTasks(true);
    // Every second, so this resolves well inside the timeout.
    await fired.promise;
    expect(getTask('ticker').previousRun()).toBeInstanceOf(Date);
  }, 5_000);

  test('cluster tasks stay unscheduled on a follower, node tasks always run', () => {
    createTask('cluster-only', { cron: '* * * * *', run: () => {} });
    createTask('every-node', { cron: '* * * * *', scope: 'node', run: () => {} });

    startTasks(false);
    expect(getTask('cluster-only').isScheduled()).toBe(false);
    expect(getTask('cluster-only').nextRun()).toBeNull();
    expect(getTask('every-node').isScheduled()).toBe(true);
    expect(getTask('every-node').nextRun()).toBeInstanceOf(Date);
  });

  test('losing the lease disarms cluster tasks but leaves node tasks alone', () => {
    createTask('cluster-only', { cron: '* * * * *', run: () => {} });
    createTask('every-node', { cron: '* * * * *', scope: 'node', run: () => {} });
    startTasks(true);
    expect(getTask('cluster-only').isScheduled()).toBe(true);

    stopClusterTasks();
    expect(getTask('cluster-only').isScheduled()).toBe(false);
    expect(getTask('every-node').isScheduled()).toBe(true);
  });

  test('a closed lease gate stops a cluster task from firing', async () => {
    let ran = 0;
    createTask('gated', {
      cron: '* * * * * *',
      run: () => {
        ran++;
      },
    });
    // Stands in for a leader whose lease lapsed between ticks.
    setTaskGate(() => false);

    const skipped = await capture('task:skipped', async () => {
      startTasks(true);
      await Bun.sleep(1_200);
    });

    expect(ran).toBe(0);
    expect(skipped[0]).toMatchObject({ task: 'gated', reason: 'lease-expired' });
  }, 5_000);

  test('pause and resume gate scheduling', () => {
    const handle = createTask('pausable', { cron: '* * * * *', run: () => {} });
    startTasks(true);
    expect(handle.isScheduled()).toBe(true);

    handle.pause();
    expect(handle.isScheduled()).toBe(false);
    handle.resume();
    expect(handle.isScheduled()).toBe(true);
  });

  test('a task declared paused does not schedule until resumed', () => {
    const handle = createTask('idle', { cron: '* * * * *', paused: true, run: () => {} });
    startTasks(true);
    expect(handle.isScheduled()).toBe(false);
  });

  test('a one-off accepts a Date and schedules for it', () => {
    const at = new Date(Date.now() + 60_000);
    const handle = createTask('once', { at, run: () => {} });
    startTasks(true);
    expect(handle.nextRun()?.getTime()).toBe(at.getTime());
  });

  test('an overlapping tick is skipped rather than piling up copies', async () => {
    const stuck = deferred();
    const handle = createTask('slowpoke', { cron: '* * * * * *', run: () => stuck.promise });

    const skipped = await capture('task:skipped', async () => {
      startTasks(true);
      await Bun.sleep(2_200);
    });

    // The first tick is still in flight, so every later one must be dropped.
    expect(handle.isBusy()).toBe(true);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
    expect(skipped[0]).toMatchObject({ task: 'slowpoke', reason: 'overlap' });
    stuck.resolve();
  }, 6_000);

  test('overlap: true lets ticks run concurrently', async () => {
    const stuck = deferred();
    let started = 0;
    createTask('parallel', {
      cron: '* * * * * *',
      overlap: true,
      run: () => {
        started++;
        return stuck.promise;
      },
    });

    const skipped = await capture('task:skipped', async () => {
      startTasks(true);
      await Bun.sleep(2_200);
    });

    expect(started).toBeGreaterThanOrEqual(2);
    expect(skipped).toHaveLength(0);
    stuck.resolve();
  }, 6_000);
});

describe('runOnStart', () => {
  test('runs once as soon as the task is armed', async () => {
    const ran = deferred();
    const handle = createTask('kickoff', { cron: '0 0 1 1 *', runOnStart: true, run: () => ran.resolve() });

    startTasks(true);
    await ran.promise;
    // croner never fired, so this exercises the lastRun fallback in previousRun().
    expect(handle.previousRun()).toBeInstanceOf(Date);
  }, 5_000);

  test('does not run for a task declared paused', async () => {
    let ran = 0;
    createTask('kickoff-paused', {
      cron: '0 0 1 1 *',
      runOnStart: true,
      paused: true,
      run: () => {
        ran++;
      },
    });

    startTasks(true);
    await Bun.sleep(50);
    expect(ran).toBe(0);
  });

  test('stopping before the run lands cancels it', async () => {
    let ran = 0;
    createTask('kickoff-cancelled', {
      cron: '0 0 1 1 *',
      runOnStart: true,
      run: () => {
        ran++;
      },
    });

    startTasks(true);
    stopAllTasks(); // synchronously, before the deferred fire
    await Bun.sleep(50);
    expect(ran).toBe(0);
  });

  test('regaining a lost lease does not repeat it', async () => {
    let ran = 0;
    createTask('kickoff-once', {
      cron: '0 0 1 1 *',
      runOnStart: true,
      run: () => {
        ran++;
      },
    });

    startTasks(true);
    await Bun.sleep(50);
    expect(ran).toBe(1);

    stopClusterTasks();
    startTasks(true);
    await Bun.sleep(50);
    expect(ran).toBe(1);
  });

  test('a closed lease gate skips it, same as a cron tick', async () => {
    let ran = 0;
    createTask('kickoff-gated', {
      cron: '0 0 1 1 *',
      runOnStart: true,
      run: () => {
        ran++;
      },
    });
    setTaskGate(() => false);

    const skipped = await capture('task:skipped', async () => {
      startTasks(true);
      await Bun.sleep(50);
    });

    expect(ran).toBe(0);
    expect(skipped[0]).toMatchObject({ task: 'kickoff-gated', reason: 'lease-expired' });
  });

  test('a node-scoped task ignores the gate entirely', async () => {
    const ran = deferred();
    createTask('kickoff-node', { cron: '0 0 1 1 *', scope: 'node', runOnStart: true, run: () => ran.resolve() });
    setTaskGate(() => false);

    startTasks(false);
    await ran.promise;
  }, 5_000);
});
