// The loader driven through a real DOM: what is left in the island once hydration throws.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/writing/' });

import { beforeEach, describe, expect, test } from 'bun:test';

// Importing for the side effect of `customElements.define`, after the DOM globals exist.
const { registerComponent } = await import('./HydratableIsland');

const settle = () => new Promise((r) => setTimeout(r, 0));

function mountIsland(name: string, ssrHtml: string, attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('mochi-hydratable-island');
  el.setAttribute('component-name', name);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  el.innerHTML = ssrHtml;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('hydration failure', () => {
  test('keeps the server-rendered markup and appends the failure marker after it', async () => {
    // Registered so the loader gets past the bundle import; the unparsable props block throws before `hydrate()`.
    registerComponent('Broken_abc', (() => {}) as never);
    const props = document.createElement('script');
    props.type = 'application/json';
    props.id = 'mochi-props-0';
    props.textContent = 'not devalue';
    document.body.appendChild(props);

    const el = mountIsland('Broken_abc', '<!--[--><p class="ssr">server text</p><!--]-->', { 'props-ref': 'mochi-props-0' });
    await settle();
    await settle();

    expect(el.querySelector('p.ssr')?.textContent).toBe('server text');
    const marker = el.querySelector('mochi-island-failure');
    expect(marker?.getAttribute('data-component')).toBe('Broken_abc');
    expect(el.lastElementChild).toBe(marker);
    expect(el.querySelectorAll('mochi-island-failure')).toHaveLength(1);
  });

  test('a client-only island whose mount throws is left with just the marker', async () => {
    registerComponent('BrokenClientOnly_abc', (() => {}) as never);
    const props = document.createElement('script');
    props.type = 'application/json';
    props.id = 'mochi-props-1';
    props.textContent = 'not devalue';
    document.body.appendChild(props);

    const el = mountIsland('BrokenClientOnly_abc', '<p class="fallback">fallback</p>', { 'props-ref': 'mochi-props-1', 'client-only': '' });
    await settle();
    await settle();

    // The fallback stays: the loader only clears it once the real component mounts, and that never happened.
    expect(el.querySelector('p.fallback')?.textContent).toBe('fallback');
    expect(el.querySelector('mochi-island-failure')?.getAttribute('data-component')).toBe('BrokenClientOnly_abc');
  });
});
