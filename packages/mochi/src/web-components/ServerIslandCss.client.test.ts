// The element's stylesheet handling driven through happy-dom: a fragment's stylesheets are linked from `<head>` and the
// swap waits for them, so deferred content never paints unstyled (the page head links none of an island's own CSS).
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// The page-level `<link>` fixtures would otherwise make happy-dom fetch them over the network.
GlobalRegistrator.register({ url: 'http://localhost/', settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { reloadDeferredIsland } from '../islands/deferInvalidation';
import { BOOTSTRAP_MARKER_ATTR } from '../islands/bootstrapMarker';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
await import('./ServerIsland');

const STUB = pathToFileURL(path.join(import.meta.dir, '..', '__fixtures__', 'defer-hydrate-standalone', 'bootstrapStub.ts')).href;
const css = (name: string) => `/_mochi/css/${name}.css`;
const linkTag = (name: string) => `<link rel="stylesheet" href="${css(name)}">`;

let bodies: string[] = [];
let fetches = 0;
// Holds the next fetch open, so a test can look at the document while the fragment is still in flight.
let holdNext = false;
let release: (() => void) | null = null;
// Stylesheets the element linked, captured instead of connected so each test settles them itself.
let linked: HTMLLinkElement[] = [];

const realFetch = globalThis.fetch;
const realAppendChild = document.head.appendChild;

beforeEach(() => {
  bodies = [];
  fetches = 0;
  holdNext = false;
  release = null;
  linked = [];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.head.appendChild = (<T extends Node>(node: T): T => {
    linked.push(node as unknown as HTMLLinkElement);
    return node;
  }) as typeof document.head.appendChild;
  globalThis.fetch = (async () => {
    fetches++;
    if (holdNext) {
      holdNext = false;
      await new Promise<void>((r) => (release = r));
    }
    return new Response(bodies.shift() ?? '<p>no body queued</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.head.appendChild = realAppendChild;
});

function mount(attrs: { cssUrl?: string; options?: Record<string, unknown> } = {}, fallback = '<p>fallback</p>'): HTMLElement {
  const el = document.createElement('mochi-server-island');
  el.setAttribute('component-name', 'Card_abc');
  el.setAttribute('data-asset-prefix', '/_mochi');
  el.setAttribute('signed-props', 'token');
  if (attrs.cssUrl) {
    el.setAttribute('css-url', attrs.cssUrl);
  }
  if (attrs.options) {
    el.setAttribute('server-options', JSON.stringify(attrs.options));
  }
  el.innerHTML = fallback;
  document.body.appendChild(el);
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const hrefs = () => linked.map((l) => l.getAttribute('href'));

async function finish(name: string, type: 'load' | 'error' = 'load'): Promise<void> {
  const link = linked.find((l) => l.getAttribute('href') === css(name));
  if (!link) {
    throw new Error(`no stylesheet linked for ${name}; linked: ${hrefs().join(', ')}`);
  }
  link.dispatchEvent(new Event(type));
  await settle();
}

describe('<mochi-server-island> stylesheets', () => {
  test('the swap waits for the island stylesheet and for every stylesheet the fragment leads with', async () => {
    bodies.push(`${linkTag('WaitChild')}<p>styled</p>`);
    const el = mount({ cssUrl: css('WaitRoot') });
    await settle();

    expect(hrefs()).toEqual([css('WaitRoot'), css('WaitChild')]);
    expect(el.innerHTML).toBe('<p>fallback</p>');

    await finish('WaitRoot');
    expect(el.innerHTML).toBe('<p>fallback</p>');

    await finish('WaitChild');
    // The links now live in the head, so the swapped-in content carries none.
    expect(el.innerHTML).toBe('<p>styled</p>');
  });

  test('the island stylesheet starts loading with the fetch, not after it', async () => {
    holdNext = true;
    bodies.push('<p>styled</p>');
    const el = mount({ cssUrl: css('EarlyRoot') });
    await settle();

    expect(fetches).toBe(1);
    expect(hrefs()).toEqual([css('EarlyRoot')]);

    // Loaded before the fragment lands, so nothing is left to wait for.
    await finish('EarlyRoot');
    release?.();
    await settle();
    expect(el.innerHTML).toBe('<p>styled</p>');
  });

  test('a stylesheet the page already links is neither requested again nor waited for', async () => {
    document.head.innerHTML = linkTag('OnPage');
    bodies.push(`${linkTag('OnPage')}<p>styled</p>`);
    const el = mount({ cssUrl: css('OnPage') });
    await settle();

    expect(linked).toEqual([]);
    expect(el.innerHTML).toBe('<p>styled</p>');
  });

  test('islands sharing a stylesheet request it once and all wait for it', async () => {
    bodies.push(`${linkTag('Shared')}<p>one</p>`, `${linkTag('Shared')}<p>two</p>`);
    const a = mount();
    const b = mount();
    await settle();

    expect(hrefs()).toEqual([css('Shared')]);
    expect(a.innerHTML).toBe('<p>fallback</p>');
    expect(b.innerHTML).toBe('<p>fallback</p>');

    await finish('Shared');
    expect([a.innerHTML, b.innerHTML].sort()).toEqual(['<p>one</p>', '<p>two</p>']);
  });

  test('a stylesheet that fails to load does not strand the fallback', async () => {
    bodies.push(`${linkTag('Missing')}<p>unstyled</p>`);
    const el = mount();
    await settle();
    expect(el.innerHTML).toBe('<p>fallback</p>');

    await finish('Missing', 'error');
    expect(el.innerHTML).toBe('<p>unstyled</p>');
  });

  test('a stylesheet that never settles gives way after a bounded wait', async () => {
    const realSetTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    // The wait is the only long timer the element arms on a successful fetch; it is captured so the test can end it.
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if ((ms ?? 0) >= 1000) {
        expire = fn;
        return 0;
      }
      return realSetTimeout(fn, ms);
    }) as unknown as typeof setTimeout;
    try {
      bodies.push(`${linkTag('Stuck')}<p>late</p>`);
      const el = mount();
      await settle();
      expect(el.innerHTML).toBe('<p>fallback</p>');
      expect(expire).toBeDefined();

      expire!();
      await settle();
      expect(el.innerHTML).toBe('<p>late</p>');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test('a reload keeps the current content until a stylesheet new to the page has loaded', async () => {
    bodies.push('<p>render 1</p>', `${linkTag('NewOnReload')}<p>render 2</p>`);
    const el = mount({ options: { name: 'css-reload' } });
    await settle();
    expect(el.innerHTML).toBe('<p>render 1</p>');

    const reloaded = reloadDeferredIsland('css-reload');
    await settle();
    expect(hrefs()).toEqual([css('NewOnReload')]);
    expect(el.innerHTML).toBe('<p>render 1</p>');
    expect(el.hasAttribute('data-reloading')).toBe(true);

    await finish('NewOnReload');
    await reloaded;
    expect(el.innerHTML).toBe('<p>render 2</p>');
    expect(el.hasAttribute('data-reloading')).toBe(false);
  });

  test('only the leading links are taken: one authored inside the content stays where it is', async () => {
    const authored = '<div><link rel="stylesheet" href="/authored.css"><p>styled</p></div>';
    bodies.push(`${linkTag('Lead')}${authored}`);
    const el = mount();
    await settle();

    expect(hrefs()).toEqual([css('Lead')]);
    await finish('Lead');
    expect(el.innerHTML).toBe(authored);
  });

  test('the hydration bootstrap loads while the stylesheets do, and the marker and links are both consumed', async () => {
    bodies.push(`<template ${BOOTSTRAP_MARKER_ATTR}="${STUB}"></template>${linkTag('WithBootstrap')}<p>styled</p>`);
    const el = mount();
    // A dynamic import settles on the loader's schedule, which on Windows CI can outlast a fixed count of ticks.
    const deadline = Date.now() + 5_000;
    while (!globalThis.__mochi_bootstrap_stub_runs && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(globalThis.__mochi_bootstrap_stub_runs).toBe(1);
    expect(el.innerHTML).toBe('<p>fallback</p>');

    await finish('WithBootstrap');
    expect(el.innerHTML).toBe('<p>styled</p>');
  });
});
