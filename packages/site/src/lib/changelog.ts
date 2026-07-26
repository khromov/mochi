import { MochiCache, logger } from 'mochi-framework';

export const CHANGELOG_URL = 'https://raw.githubusercontent.com/khromov/mochi/refs/heads/main/packages/mochi/CHANGELOG.md';
export const CHANGELOG_SLUG = 'changelog';
export const CHANGELOG_TITLE = 'Changelog';
export const CHANGELOG_DESCRIPTION = 'Release notes for every mochi-framework version.';

const changelogCache = new MochiCache({
  minTimeToStale: 14_400_000, // 4h — after this, serve stale and refresh in the background
  maxTimeToLive: 86_400_000, // 24h
});

/** The upstream CHANGELOG.md, or null when it can't be fetched and nothing is cached. */
export async function getChangelogTxt(): Promise<string | null> {
  try {
    return await changelogCache.fetch('changelog', async () => {
      const res = await fetch(CHANGELOG_URL);
      // Throw on a non-2xx so an HTML 404 page is never cached as changelog content.
      if (!res.ok) {
        throw new Error(`CHANGELOG fetch failed: ${res.status} ${res.statusText}`);
      }
      return await res.text();
    });
  } catch (err) {
    // GitHub being unreachable must never break the rest of the site — the caller
    // (route/index) turns a null into a 503 or omits the changelog block.
    logger.warn('[changelog] fetch failed:', err);
    return null;
  }
}
