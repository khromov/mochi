import { afterAll, expect, spyOn, test } from 'bun:test';
import { fetchItem } from './hn-api.ts';
import { ITEM_CACHE_MAX_ENTRIES, itemCache } from './hn-cache.ts';

const upstream = spyOn(globalThis, 'fetch').mockImplementation((async () => Response.json({ id: 1, type: 'comment', time: 0, text: 'x' })) as unknown as typeof fetch);

afterAll(() => {
  upstream.mockRestore();
});

test('itemCache holds at most ITEM_CACHE_MAX_ENTRIES items however many distinct ids are requested', async () => {
  const total = ITEM_CACHE_MAX_ENTRIES * 2 + 500;
  for (let start = 1; start <= total; start += 1000) {
    await Promise.all(Array.from({ length: Math.min(1000, total - start + 1) }, (_, i) => fetchItem(start + i)));
  }

  let cached = 0;
  for (let id = 1; id <= total; id++) {
    if (await itemCache.peek(`item:${id}`)) {
      cached++;
    }
  }

  expect(upstream).toHaveBeenCalledTimes(total);
  expect(cached).toBeGreaterThan(0);
  expect(cached).toBeLessThanOrEqual(ITEM_CACHE_MAX_ENTRIES);
  expect(await itemCache.peek(`item:${total}`)).not.toBeNull();
});
