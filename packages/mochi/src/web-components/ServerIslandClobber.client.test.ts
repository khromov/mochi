// A page element whose id matches a framework global must not break `<mochi-server-island>`, driven through happy-dom.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/', settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });

import { afterAll, expect, test } from 'bun:test';

const originalProto = Object.getPrototypeOf(globalThis);
const clobber = document.createElement('p');
clobber.id = '__mochi_loaded_css__';
document.body.appendChild(clobber);
// happy-dom has no DOM named access, so expose the element where the browser's WindowProperties object would.
Object.setPrototypeOf(globalThis, Object.create(originalProto, { [clobber.id]: { value: clobber, writable: true, configurable: true } }));

await import('./ServerIsland');

const realFetch = globalThis.fetch;
const realAppendChild = document.head.appendChild;

afterAll(() => {
  globalThis.fetch = realFetch;
  document.head.appendChild = realAppendChild;
  Object.setPrototypeOf(globalThis, originalProto);
});

test('an element with the stylesheet tracker id neither strands the island nor makes it refetch', async () => {
  const linked: HTMLLinkElement[] = [];
  document.head.appendChild = (<T extends Node>(node: T): T => {
    linked.push(node as unknown as HTMLLinkElement);
    return node;
  }) as typeof document.head.appendChild;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches++;
    return new Response('<link rel="stylesheet" href="/_mochi/css/Child.css"><p>loaded</p>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as unknown as typeof fetch;

  const el = document.createElement('mochi-server-island');
  el.setAttribute('component-name', 'Card_abc');
  el.setAttribute('data-asset-prefix', '/_mochi');
  el.setAttribute('css-url', '/_mochi/css/Card.css');
  el.innerHTML = '<p>fallback</p>';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));

  expect(linked.map((l) => l.getAttribute('href'))).toEqual(['/_mochi/css/Card.css', '/_mochi/css/Child.css']);
  for (const link of linked) {
    link.dispatchEvent(new Event('load'));
  }
  await new Promise((r) => setTimeout(r, 0));

  expect(el.innerHTML).toBe('<p>loaded</p>');
  expect(fetches).toBe(1);
});
