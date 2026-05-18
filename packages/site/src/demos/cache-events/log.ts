import { MochiCache, mochiEvents, logger } from 'mochi-framework';
import { delay } from '../../components/utils';

export const slowClock = new MochiCache({
  minTimeToStale: 3_000,
  maxTimeToLive: 10_000,
});

// Custom integration: every cache event is printed via mochi-framework's `logger`
// with an in-message tag so it's easy to grep alongside the framework's own
// lines. setHandler (rather than .on) means dev re-imports don't pile up
// duplicate subscribers.
mochiEvents.setHandler('demo:cache-events:read', 'cache:read', ({ key, status }) => {
  logger.info(`[demo:cache-events] read       ${key} → ${status}`);
});

mochiEvents.setHandler('demo:cache-events:revalidate', 'cache:revalidate', ({ key }) => {
  logger.info(`[demo:cache-events] revalidate ${key}`);
});

export async function getSlowTime() {
  return slowClock.fetchWithStatus('slow-clock', async () => {
    await delay(150);
    return new Date().toISOString();
  });
}
