import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CHANGELOG_URL, getChangelogTxt } from './changelog';

const realFetch = globalThis.fetch;

// The cache stays fresh for 4h after a successful fetch, so failure cases must run
// before the success case — bun runs tests top-to-bottom, which this order relies on.
describe('changelog', () => {
  let fetchCount = 0;
  let mode: 'ok' | 'not-ok' | 'throw' = 'throw';

  beforeAll(() => {
    // Every test file runs in its own process (run-tests.ts), so stubbing the
    // global fetch here can't leak into other files.
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === CHANGELOG_URL) {
        fetchCount++;
        if (mode === 'throw') {
          throw new Error('network down');
        }
        if (mode === 'not-ok') {
          return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        }
        return new Response('# Changelog\n\n## [0.8.0]\n');
      }
      return realFetch(input as never);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test('a thrown fetch returns null without throwing (nothing cached)', async () => {
    mode = 'throw';
    await expect(getChangelogTxt()).resolves.toBeNull();
  });

  test('a non-ok response returns null and is not cached', async () => {
    mode = 'not-ok';
    await expect(getChangelogTxt()).resolves.toBeNull();
  });

  test('a successful fetch returns the body', async () => {
    mode = 'ok';
    const text = await getChangelogTxt();
    expect(text).toContain('# Changelog');
    expect(text).toContain('0.8.0');
  });

  test('a second call is served from cache (no re-fetch)', async () => {
    // Flip the stub back to throwing: if the second call re-fetched it would return
    // null, so a body proves the cached copy was served.
    mode = 'throw';
    const before = fetchCount;
    const text = await getChangelogTxt();
    expect(text).toContain('# Changelog');
    expect(fetchCount).toBe(before);
  });
});
