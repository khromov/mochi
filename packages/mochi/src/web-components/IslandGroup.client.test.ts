// The `<mochi-island-group>` coordinator driven through a real DOM: one fetch for the whole group, per-member swap,
// reload coalescing under both the group name and a member `name`, and the group-wide viewport trigger.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isReloadingDeferredIsland, reloadDeferredIsland, reloadDeferredIslandAll, subscribeDeferredIsland } from '../islands/deferInvalidation';
import { BOOTSTRAP_MARKER_ATTR } from '../islands/bootstrapMarker';

// Imported for the side effect of `customElements.define`, after the DOM globals exist. ServerIsland pulls IslandGroup
// in, so this covers both halves.
await import('./ServerIsland');

let urls: string[] = [];
let round = 0;
let failNext = 0;
let status = 200;
// Holds the next fetch only, so a test can pin one open and inspect the group mid-round.
let holdNext = false;
let release: (() => void) | null = null;
// When set, the group response uses this instead of the default per-member body.
let bodyFor: ((id: string) => string) | null = null;

const realFetch = globalThis.fetch;

// Every observer created during a test, so a test can drive the viewport trigger by hand.
const observers: Array<{ callback: IntersectionObserverCallback; instance: IntersectionObserver; targets: Element[] }> = [];

class FakeIntersectionObserver {
  targets: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    observers.push({ callback, instance: this as unknown as IntersectionObserver, targets: this.targets });
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  urls = [];
  round = 0;
  failNext = 0;
  status = 200;
  observers.length = 0;
  holdNext = false;
  release = null;
  bodyFor = null;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver;
  globalThis.fetch = (async (input: string) => {
    urls.push(String(input));
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((r) => (release = r));
    }
    if (failNext > 0) {
      failNext--;
      return new Response('nope', { status });
    }
    round++;
    const g = new URL(String(input), 'http://localhost').searchParams.get('g') ?? '';
    // Members are encoded into the fake token as `a,b,c`, so one request answers whichever ids it was asked for.
    const ids = g.split(',').filter(Boolean);
    return Response.json({ m: Object.fromEntries(ids.map((id) => [id, bodyFor ? bodyFor(id) : `<p>${id} round ${round}</p>`])) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Mirrors what `renderIslandGroupMarkup` emits: members first, coordinator last. */
function mountGroup(opts: {
  group?: string;
  groupId?: string;
  members: Array<{ iid: string; name?: string }>;
  chunks?: string[];
  options?: Record<string, unknown>;
  lazy?: boolean;
}): {
  members: HTMLElement[];
  coordinator: HTMLElement;
} {
  const group = opts.group ?? 'stars';
  const groupId = opts.groupId ?? 'gs1-0';
  const members = opts.members.map(({ iid, name }) => {
    const el = document.createElement('mochi-server-island');
    el.setAttribute('component-name', 'RepoStars_abc');
    el.setAttribute('data-asset-prefix', '/_mochi');
    el.setAttribute('server-group', groupId);
    el.setAttribute('group-member', iid);
    if (name) {
      el.setAttribute('server-options', JSON.stringify({ name }));
    }
    el.innerHTML = '<span>…</span>';
    document.body.appendChild(el);
    return el;
  });

  const coordinator = document.createElement('mochi-island-group');
  coordinator.setAttribute('group', group);
  coordinator.setAttribute('group-id', groupId);
  coordinator.setAttribute('data-asset-prefix', '/_mochi');
  coordinator.setAttribute('chunks', (opts.chunks ?? [opts.members.map((m) => m.iid).join(',')]).join(' '));
  if (opts.options) {
    coordinator.setAttribute('server-options', JSON.stringify(opts.options));
  }
  if (opts.lazy) {
    coordinator.setAttribute('defer-on', 'visible');
  }
  document.body.appendChild(coordinator);
  return { members, coordinator };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('<mochi-island-group>', () => {
  test('one request fills every member', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }, { iid: 'c' }] });
    await settle();

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('/_mochi/island-group/stars?g=a,b,c');
    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a round 1</p>', '<p>b round 1</p>', '<p>c round 1</p>']);
  });

  test('members never fetch for themselves', async () => {
    mountGroup({ members: [{ iid: 'a' }] });
    await settle();
    expect(urls.every((u) => u.startsWith('/_mochi/island-group/'))).toBe(true);
  });

  test('a group of one behaves like an ordinary defer', async () => {
    const { members } = mountGroup({ members: [{ iid: 'solo' }] });
    await settle();
    expect(urls).toHaveLength(1);
    expect(members[0]!.innerHTML).toBe('<p>solo round 1</p>');
  });

  test('a split group issues one request per chunk, in parallel', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }, { iid: 'c' }], chunks: ['a,b', 'c'] });
    await settle();

    expect(urls.sort()).toEqual(['/_mochi/island-group/stars?g=a,b', '/_mochi/island-group/stars?g=c']);
    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a round 1</p>', '<p>b round 1</p>', '<p>c round 2</p>']);
  });

  test('the group name is a reload handle, and one reload is one request', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }] });
    await settle();

    await reloadDeferredIsland('stars');
    expect(urls).toHaveLength(2);
    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a round 2</p>', '<p>b round 2</p>']);
  });

  test('reloading a named member reloads the whole group, coalesced into one request', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a', name: 'cart' }, { iid: 'b', name: 'cart' }, { iid: 'c' }] });
    await settle();

    await reloadDeferredIsland('cart');
    // Two islands registered under `cart`, one shared round.
    expect(urls).toHaveLength(2);
    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a round 2</p>', '<p>b round 2</p>', '<p>c round 2</p>']);
  });

  test('reloadDeferredIslandAll reloads the group once even when members are also named', async () => {
    mountGroup({ members: [{ iid: 'a', name: 'cart' }, { iid: 'b' }] });
    await settle();

    await reloadDeferredIslandAll();
    expect(urls).toHaveLength(2);
  });

  test('members carry data-reloading for the round, and report reloading under both handles', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a', name: 'cart' }, { iid: 'b' }] });
    await settle();
    expect(isReloadingDeferredIsland('stars')).toBe(false);

    holdNext = true;
    const pending = reloadDeferredIsland('stars');
    // The flag is synchronous so a `deferReloadState` read right after the call already shows the wait.
    expect(isReloadingDeferredIsland('stars')).toBe(true);
    expect(isReloadingDeferredIsland('cart')).toBe(true);

    await settle();
    expect(members.every((m) => m.hasAttribute('data-reloading'))).toBe(true);
    expect(members.every((m) => m.getAttribute('aria-busy') === 'true')).toBe(true);

    release!();
    await pending;
    expect(members.some((m) => m.hasAttribute('data-reloading'))).toBe(false);
    expect(isReloadingDeferredIsland('stars')).toBe(false);
  });

  test('each handle settles its own round, and both see the group going busy', async () => {
    const done: Record<string, boolean[]> = { stars: [], cart: [] };
    const edges: Record<string, number> = { stars: 0, cart: 0 };
    const off = (['stars', 'cart'] as const).map((name) =>
      subscribeDeferredIsland(name, (c) => {
        edges[name]!++;
        if (c.ok !== undefined) {
          done[name]!.push(c.ok);
        }
      }),
    );
    mountGroup({ members: [{ iid: 'a', name: 'cart' }, { iid: 'b' }] });
    await settle();

    await reloadDeferredIsland('cart');
    expect(done.cart).toEqual([true]);
    await reloadDeferredIsland('stars');
    expect(done.stars).toEqual([true]);
    // Both handles are notified on every edge, so `deferReloadState(...).reloading` is right either way.
    expect(edges.stars).toBeGreaterThan(2);
    expect(edges.cart).toBeGreaterThan(2);
    off.forEach((fn) => fn());
  });

  test('a failing group retries with backoff and reports the failure', async () => {
    status = 500;
    failNext = 1;
    const { members } = mountGroup({ members: [{ iid: 'a' }], options: { retries: 1 } });
    // One 500, then the retry delay, then success.
    await new Promise((r) => setTimeout(r, 1100));

    expect(urls).toHaveLength(2);
    expect(members[0]!.innerHTML).toBe('<p>a round 1</p>');
  });

  test('a 4xx stops immediately instead of burning the retry budget', async () => {
    status = 403;
    failNext = 5;
    const { members } = mountGroup({ members: [{ iid: 'a' }], options: { retries: 3 } });
    await settle();

    expect(urls).toHaveLength(1);
    expect(members[0]!.innerHTML).toBe('<span>…</span>');
  });

  test('a lazy group waits for the first member to scroll into view, then fetches all of them', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }], lazy: true, options: { rootMargin: '200px' } });
    await settle();
    expect(urls).toHaveLength(0);
    // Every member is observed, so whichever one appears first triggers the group.
    expect(observers[0]!.targets).toHaveLength(2);

    observers[0]!.callback([{ isIntersecting: true } as IntersectionObserverEntry], observers[0]!.instance);
    await settle();

    expect(urls).toHaveLength(1);
    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a round 1</p>', '<p>b round 1</p>']);
  });

  test('each member consumes its own bootstrap marker, and the module map evaluates it once', async () => {
    const stub = pathToFileURL(path.join(import.meta.dir, '..', '__fixtures__', 'defer-hydrate-standalone', 'bootstrapStub.ts')).href;
    const before = globalThis.__mochi_bootstrap_stub_runs ?? 0;
    bodyFor = (id) => `<template ${BOOTSTRAP_MARKER_ATTR}="${stub}"></template><p>${id}</p>`;
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }] });

    const deadline = Date.now() + 5_000;
    while (members.some((m) => m.querySelector(`[${BOOTSTRAP_MARKER_ATTR}]`) || m.innerHTML.includes('…')) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(members.map((m) => m.innerHTML)).toEqual(['<p>a</p>', '<p>b</p>']);
    // One request, two markers consumed, one evaluation — the module map collapses the pair.
    expect(urls).toHaveLength(1);
    expect((globalThis.__mochi_bootstrap_stub_runs ?? 0) - before).toBe(1);
  });

  test('removing a member takes it out of the next round', async () => {
    const { members } = mountGroup({ members: [{ iid: 'a' }, { iid: 'b' }] });
    await settle();
    members[1]!.remove();

    await reloadDeferredIsland('stars');
    expect(members[0]!.innerHTML).toBe('<p>a round 2</p>');
    expect(members[1]!.innerHTML).toBe('<p>b round 1</p>');
  });
});
