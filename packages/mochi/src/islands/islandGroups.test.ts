// Unit coverage for the server half of `mochi:defer={{ group }}`: collection into the per-render registry, the
// group-name validation that mirrors `name`'s, and the URL-budget chunking that keeps an oversized group's `?g=` token
// from growing past what proxies accept.
import { beforeAll, describe, expect, test } from 'bun:test';
import { parse as devalueParse } from 'devalue';
import { Mochi } from '../Mochi';
import { decryptPayload } from './payloadCrypto';
import {
  DEFAULT_GROUP_URL_BUDGET,
  collectGroupedIsland,
  groupAad,
  isValidGroupName,
  parseGroupPayload,
  renderIslandGroupMarkup,
  sealGroupChunks,
  serverIslandAttrs,
  type IslandGroupEntry,
  type IslandGroupState,
} from './islandGroups';
import { requestContext, type MochiRequestContext } from '../runtime/requestContext';

// `encryptPayload` reads the resolved Mochi config for its key, so the suite needs a configured process. No server is
// started: `mochiConfig` is initialized as a side effect of the call.
beforeAll(async () => {
  const server = await Mochi.serve({ port: 0, development: false, logger: { enabled: false }, routes: {} });
  await server.stop(true);
});

function withCtx<T>(groups: Map<string, IslandGroupState>, fn: () => T): T {
  return requestContext.run({ islandGroups: groups, islandProps: new Map() } as unknown as MochiRequestContext, fn);
}

function entries(n: number, props: (i: number) => Record<string, unknown> = (i) => ({ repo: `some-repo-name-${i}` })): IslandGroupEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    islandKey: 'RepoStars_a1b2c3d4',
    propsJson: JSON.stringify(props(i)),
    iid: `s1-${i}`,
  }));
}

describe('isValidGroupName', () => {
  test('accepts non-empty strings only', () => {
    expect(isValidGroupName('stars')).toBe(true);
    expect(isValidGroupName('')).toBe(false);
    expect(isValidGroupName(0)).toBe(false);
    expect(isValidGroupName(null)).toBe(false);
    expect(isValidGroupName(undefined)).toBe(false);
    expect(isValidGroupName({})).toBe(false);
  });
});

describe('collectGroupedIsland', () => {
  test('collects members under one group id and keeps render order', () => {
    const groups = new Map<string, IslandGroupState>();
    const a = withCtx(groups, () => collectGroupedIsland({ group: 'stars' }, 'A_1', '{"n":1}', 's1-0', false));
    const b = withCtx(groups, () => collectGroupedIsland({ group: 'stars' }, 'B_2', '{"n":2}', 's1-1', false));

    expect(a).toEqual({ groupId: 'gs1-0', member: 's1-0' });
    expect(b).toEqual({ groupId: 'gs1-0', member: 's1-1' });
    const state = groups.get('stars')!;
    expect(state.entries.map((e) => e.iid)).toEqual(['s1-0', 's1-1']);
    expect(state.entries.map((e) => e.islandKey)).toEqual(['A_1', 'B_2']);
  });

  test('a group of one still collects — it behaves like an ordinary defer, over the group endpoint', () => {
    const groups = new Map<string, IslandGroupState>();
    expect(withCtx(groups, () => collectGroupedIsland({ group: 'solo' }, 'A_1', '{}', 's1-0', false))).toEqual({ groupId: 'gs1-0', member: 's1-0' });
    expect(groups.get('solo')!.entries).toHaveLength(1);
  });

  test('keeps only `name` on the member and moves the fetch policy to the group', () => {
    const groups = new Map<string, IslandGroupState>();
    const attrs = withCtx(groups, () => collectGroupedIsland({ group: 'stars', name: 'cart', retries: 3, inline: true }, 'A_1', '{}', 's1-0', false));
    expect(attrs).toEqual({ groupId: 'gs1-0', member: 's1-0', options: '{"name":"cart"}' });
    expect(groups.get('stars')!.options).toEqual({ retries: 3 });
  });

  test('an invalid group falls back to an ungrouped defer', () => {
    for (const group of ['', 0, null, {}]) {
      const groups = new Map<string, IslandGroupState>();
      expect(withCtx(groups, () => collectGroupedIsland({ group }, 'A_1', '{}', 's1-0', false))).toBeNull();
      expect(groups.size).toBe(0);
    }
  });

  test('no group key, no collection', () => {
    const groups = new Map<string, IslandGroupState>();
    expect(withCtx(groups, () => collectGroupedIsland({ retries: 2 }, 'A_1', '{}', 's1-0', false))).toBeNull();
    expect(withCtx(groups, () => collectGroupedIsland(undefined, 'A_1', '{}', 's1-0', false))).toBeNull();
  });

  test('outside a render there is no collector, so a grouped island seals its own token', () => {
    expect(collectGroupedIsland({ group: 'stars' }, 'A_1', '{}', 's1-0', false)).toBeNull();
    const attrs = serverIslandAttrs({ group: 'stars' }, 'A_1', '{"a":1}', 's1-0', false);
    expect(attrs.token).toBeTypeOf('string');
    expect(attrs.groupId).toBeUndefined();
  });

  test('lazy only while every member is mochi:defer:visible', () => {
    const allLazy = new Map<string, IslandGroupState>();
    withCtx(allLazy, () => collectGroupedIsland({ group: 'g' }, 'A_1', '{}', 's1-0', true));
    withCtx(allLazy, () => collectGroupedIsland({ group: 'g' }, 'B_1', '{}', 's1-1', true));
    expect(allLazy.get('g')!.lazy).toBe(true);

    const mixed = new Map<string, IslandGroupState>();
    withCtx(mixed, () => collectGroupedIsland({ group: 'g' }, 'A_1', '{}', 's1-0', true));
    withCtx(mixed, () => collectGroupedIsland({ group: 'g' }, 'B_1', '{}', 's1-1', false));
    expect(mixed.get('g')!.lazy).toBe(false);
  });
});

describe('sealGroupChunks', () => {
  const overhead = '/_mochi/island-group/stars?g='.length;

  test('round-trips through the group AAD, deduplicating component names', () => {
    const [token] = sealGroupChunks('stars', entries(3), overhead);
    const payload = parseGroupPayload(devalueParse(decryptPayload(token!, { aad: groupAad('stars') })!));
    expect(payload!.n).toEqual(['RepoStars_a1b2c3d4']);
    expect(payload!.e.map(([i, iid]) => [i, iid])).toEqual([
      [0, 's1-0'],
      [0, 's1-1'],
      [0, 's1-2'],
    ]);
    expect(JSON.parse(payload!.e[2]![2])).toEqual({ repo: 'some-repo-name-2' });
  });

  test('a token sealed for one group does not decrypt for another', () => {
    const [token] = sealGroupChunks('stars', entries(2), overhead);
    expect(decryptPayload(token!, { aad: groupAad('feeds') })).toBeNull();
  });

  test('12 small-prop islands seal into one request well under the budget', () => {
    const chunks = sealGroupChunks('stars', entries(12), overhead);
    expect(chunks).toHaveLength(1);
    expect(overhead + chunks[0]!.length).toBeLessThan(DEFAULT_GROUP_URL_BUDGET);
  });

  test('an oversized group splits into several chunks, each within budget', () => {
    const big = entries(100, (i) => ({
      repo: `some-repo-name-${i}`,
      title: `Project number ${i} with a reasonably long descriptive title`,
      tags: ['svelte', 'bun', 'typescript'],
    }));
    const chunks = sealGroupChunks('stars', big, overhead);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(overhead + chunk.length).toBeLessThanOrEqual(DEFAULT_GROUP_URL_BUDGET);
    }
    // Every member lands in exactly one chunk, once.
    const ids = chunks.flatMap((chunk) => parseGroupPayload(devalueParse(decryptPayload(chunk, { aad: groupAad('stars') })!))!.e.map(([, iid]) => iid));
    expect(new Set(ids).size).toBe(100);
    expect(ids).toHaveLength(100);
  });

  test('a lone member that overflows on its own is still emitted rather than dropped', () => {
    const huge = [{ islandKey: 'A_1', propsJson: JSON.stringify({ blob: crypto.getRandomValues(new Uint8Array(4096)).join('') }), iid: 's1-0' }];
    const chunks = sealGroupChunks('stars', huge, overhead, 200);
    expect(chunks).toHaveLength(1);
  });

  test('no entries, no chunks', () => {
    expect(sealGroupChunks('stars', [], overhead)).toEqual([]);
  });
});

describe('parseGroupPayload', () => {
  test('rejects anything that is not a well-formed group payload', () => {
    expect(parseGroupPayload(null)).toBeNull();
    expect(parseGroupPayload({ n: ['A'], e: 'nope' })).toBeNull();
    expect(parseGroupPayload({ n: [1], e: [] })).toBeNull();
    // Index out of range for the name table — a forged payload must not read past it.
    expect(parseGroupPayload({ n: ['A'], e: [[1, 's1-0', '{}']] })).toBeNull();
    expect(parseGroupPayload({ n: ['A'], e: [[-1, 's1-0', '{}']] })).toBeNull();
    expect(parseGroupPayload({ n: ['A'], e: [[0, 's1-0']] })).toBeNull();
    expect(parseGroupPayload({ n: ['A'], e: [[0, 5, '{}']] })).toBeNull();
    expect(parseGroupPayload({ n: ['A'], e: [[0, 's1-0', '{}']] })).toEqual({ n: ['A'], e: [[0, 's1-0', '{}']] });
  });
});

describe('renderIslandGroupMarkup', () => {
  test('emits one coordinator per group, carrying the chunks and the group-owned options', () => {
    const groups = new Map<string, IslandGroupState>();
    withCtx(groups, () => collectGroupedIsland({ group: 'stars', retries: 2 }, 'A_1', '{}', 's1-0', false));
    withCtx(groups, () => collectGroupedIsland({ group: 'feeds' }, 'B_1', '{}', 's1-1', true));

    const markup = renderIslandGroupMarkup(groups, '/_mochi');
    expect(markup).toContain('<mochi-island-group group="stars" group-id="gs1-0"');
    expect(markup).toContain('server-options="{&quot;retries&quot;:2}"');
    expect(markup).toContain('<mochi-island-group group="feeds" group-id="gs1-1"');
    // Only the all-visible group is lazy.
    expect(markup.match(/defer-on="visible"/g)).toHaveLength(1);
    expect(markup).toContain('data-asset-prefix="/_mochi"');
  });

  test('an empty group registry emits nothing', () => {
    expect(renderIslandGroupMarkup(new Map(), '/_mochi')).toBe('');
  });
});
