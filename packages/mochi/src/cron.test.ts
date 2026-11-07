import { describe, expect, test } from 'bun:test';
import { createCronJob } from './cron';

describe('Mochi.cron() declaration', () => {
  test('returns an inert descriptor', () => {
    const job = createCronJob('cleanup', '0 3 * * *', () => {});

    expect(job.__mochiCron).toBe(true);
    expect(job.name).toBe('cleanup');
    expect(job.schedule).toBe('0 3 * * *');
    expect(job.run).toBeInstanceOf(Function);
  });

  test('accepts a bare handler or a { run } config', () => {
    expect(createCronJob('a', '@daily', () => {}).run).toBeInstanceOf(Function);
    expect(createCronJob('b', '@daily', { run: () => {}, tz: 'UTC' }).options?.tz).toBe('UTC');
  });

  test('nextRun resolves a concrete time from the schedule', () => {
    const from = Date.UTC(2026, 0, 1, 10, 30, 0);
    expect(createCronJob('hourly', '0 * * * *', { run: () => {}, tz: 'UTC' }).nextRun(from)).toBe(Date.UTC(2026, 0, 1, 11, 0, 0));
  });

  // Failing at import time is the point: a typo surfaces when the module loads, not after a deploy boots.
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
