import { describe, expect, test } from 'bun:test';
import { mochiEvents } from 'mochi-framework';
import { MAX_PENDING_NOTIFICATION_JOBS, QUEUE_NAME, queueStatus, reserveNotificationSlot } from './queue.server';

describe('queue demo admission', () => {
  test('rejects reservations at the configured pending-job cap and recovers after release', () => {
    const releases = Array.from({ length: MAX_PENDING_NOTIFICATION_JOBS }, () => reserveNotificationSlot());
    expect(releases.every(Boolean)).toBe(true);
    expect(reserveNotificationSlot()).toBeNull();

    releases[0]?.();
    const replacement = reserveNotificationSlot();
    expect(typeof replacement).toBe('function');

    replacement?.();
    for (const release of releases.slice(1)) {
      release?.();
    }
  });

  // Without the TTL a job that lost its terminal event pins the count up and the demo reads "full" for every visitor.
  test('ages out a pending job that never reported a terminal event', () => {
    mochiEvents.emit('queue:added', { queue: QUEUE_NAME, jobId: 'stuck' });
    expect(queueStatus().inFlight).toBe(1);

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      expect(queueStatus().inFlight).toBe(0);
      const release = reserveNotificationSlot();
      expect(typeof release).toBe('function');
      release?.();
    } finally {
      Date.now = realNow;
    }
  });
});
