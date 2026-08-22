import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createCronJob, registeredCronJobs, startCronJobs, stopAllCronJobs } from './cron';
import { mochiEvents } from './events';

afterEach(() => {
  stopAllCronJobs();
  jest.useRealTimers();
});

describe('Mochi.cron() declaration', () => {
  test('returns an inert descriptor — nothing is scheduled until serve starts it', () => {
    const job = createCronJob('cleanup', '0 3 * * *', () => {});

    expect(job.__mochiCron).toBe(true);
    expect(job.name).toBe('cleanup');
    expect(job.schedule).toBe('0 3 * * *');
    expect(registeredCronJobs()).toEqual([]);
  });

  test('accepts a bare handler or a { run } config', () => {
    expect(createCronJob('a', '@daily', () => {}).run).toBeInstanceOf(Function);
    expect(createCronJob('b', '@daily', { run: () => {}, tz: 'UTC' }).options?.tz).toBe('UTC');
  });

  test('nextRun resolves a concrete time from the schedule', () => {
    const from = Date.UTC(2026, 0, 1, 10, 30, 0);
    const next = createCronJob('hourly', '0 * * * *', { run: () => {}, tz: 'UTC' }).nextRun(from);

    expect(next).toBe(Date.UTC(2026, 0, 1, 11, 0, 0));
  });

  // Failing at import time is the point: a typo must not wait until a deploy boots to surface.
  test('rejects a malformed schedule with the expression in the message', () => {
    expect(() => createCronJob('digest', 'not a schedule', () => {})).toThrow('is not a valid cron schedule');
  });

  test('rejects an unknown time zone', () => {
    expect(() => createCronJob('digest', '0 9 * * *', { run: () => {}, tz: 'Mars/Olympus_Mons' })).toThrow('Mars/Olympus_Mons');
  });

  test('rejects a schedule that can never fire', () => {
    expect(() => createCronJob('impossible', '0 0 30 2 *', () => {})).toThrow('no occurrence in the next 8 years');
  });

  test('rejects an invalid job name', () => {
    expect(() => createCronJob('bad name', '@daily', () => {})).toThrow('not a valid cron job name');
  });

  test('rejects a missing handler', () => {
    expect(() => createCronJob('nohandler', '@daily', {} as never)).toThrow('expected a handler function');
  });
});

describe('startCronJobs', () => {
  test('registers and stops jobs by name', () => {
    startCronJobs([createCronJob('a', '@daily', () => {}), createCronJob('b', '@hourly', () => {})], { development: false });
    expect(registeredCronJobs().sort()).toEqual(['a', 'b']);

    stopAllCronJobs();
    expect(registeredCronJobs()).toEqual([]);
  });

  test('stopAllCronJobs is idempotent', () => {
    startCronJobs([createCronJob('a', '@daily', () => {})], { development: false });
    stopAllCronJobs();
    expect(() => stopAllCronJobs()).not.toThrow();
  });

  test('skips a job marked dev:false when development is on, and keeps it in production', () => {
    startCronJobs([createCronJob('prod-only', '@daily', { run: () => {}, dev: false })], { development: true });
    expect(registeredCronJobs()).toEqual([]);

    startCronJobs([createCronJob('prod-only', '@daily', { run: () => {}, dev: false })], { development: false });
    expect(registeredCronJobs()).toEqual(['prod-only']);
  });

  test('emits cron:scheduled with the schedule and the next fire time', () => {
    const events: { job: string; schedule: string; nextRun?: number }[] = [];
    const handler = (payload: { job: string; schedule: string; nextRun?: number }) => events.push(payload);
    mochiEvents.on('cron:scheduled', handler);
    try {
      startCronJobs([createCronJob('nightly', '0 3 * * *', () => {})], { development: false });
    } finally {
      mochiEvents.off('cron:scheduled', handler);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ job: 'nightly', schedule: '0 3 * * *' });
    expect(events[0]!.nextRun).toBeGreaterThan(Date.now());
  });
});

describe('handler invocation under fake timers', () => {
  test('fires on schedule and reports completion', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let runs = 0;
    const completed: string[] = [];
    const onCompleted = ({ job }: { job: string }) => completed.push(job);
    mochiEvents.on('cron:completed', onCompleted);

    try {
      startCronJobs([createCronJob('every-minute', '* * * * *', () => void runs++)], { development: false });
      jest.advanceTimersByTime(61_000);
    } finally {
      mochiEvents.off('cron:completed', onCompleted);
    }

    expect(runs).toBeGreaterThanOrEqual(1);
    expect(completed).toContain('every-minute');
  });

  // The reason cron goes through Mochi at all: a bare Bun.cron handler that throws reaches unhandledRejection and
  // exits the process with code 1. Here it must be one event and one log line, with the schedule still running.
  test('a throwing handler is reported through cron:failed and never rejects', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const failures: { job: string; error: string }[] = [];
    const onFailed = (payload: { job: string; error: string }) => failures.push(payload);
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    mochiEvents.on('cron:failed', onFailed);
    process.on('unhandledRejection', onRejection);

    try {
      startCronJobs(
        [
          createCronJob('explodes', '* * * * *', () => {
            throw new Error('boom from a cron job');
          }),
        ],
        { development: false },
      );
      jest.advanceTimersByTime(61_000);
      jest.useRealTimers();
      // Let any rejection that was going to escape actually surface.
      await Bun.sleep(20);
    } finally {
      mochiEvents.off('cron:failed', onFailed);
      process.off('unhandledRejection', onRejection);
    }

    expect(failures).toHaveLength(1);
    expect(failures[0]!.error).toBe('boom from a cron job');
    expect(rejections).toEqual([]);
    // Still scheduled: one failure must not cancel the job.
    expect(registeredCronJobs()).toEqual(['explodes']);
  });

  test('a listener that throws does not change the run outcome', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let ran = false;

    startCronJobs(
      [
        createCronJob('noisy', '* * * * *', {
          run: () => void (ran = true),
          on: {
            active: () => {
              throw new Error('listener exploded');
            },
          },
        }),
      ],
      { development: false },
    );
    expect(() => jest.advanceTimersByTime(61_000)).not.toThrow();
    expect(ran).toBe(true);
  });
});
