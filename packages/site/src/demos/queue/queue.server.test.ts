import { describe, expect, test } from 'bun:test';
import { MAX_PENDING_NOTIFICATION_JOBS, reserveNotificationSlot } from './queue.server';

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
});
