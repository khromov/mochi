import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterEach, describe, expect, test } from 'bun:test';
import { resolveIslandProps } from './resolveIslandProps';

afterEach(() => {
  document.body.innerHTML = '';
});

const island = (): Element => {
  const el = document.createElement('mochi-hydratable-island');
  el.setAttribute('props-ref', 'mochi-props-0');
  return el;
};

const propsBlock = (payload: string): string => `<script type="application/json" id="mochi-props-0">${payload}</script>`;

describe('resolveIslandProps', () => {
  test('nested island reads its server island block, not the colliding page block', () => {
    document.body.innerHTML = `
      ${propsBlock('PAGE')}
      <mochi-hydratable-island component-name="Page" props-ref="mochi-props-0"></mochi-hydratable-island>
      <mochi-server-island>
        ${propsBlock('ISLAND')}
        <mochi-hydratable-island component-name="Nested" props-ref="mochi-props-0"></mochi-hydratable-island>
      </mochi-server-island>`;

    const [pageIsland, nestedIsland] = [...document.querySelectorAll('mochi-hydratable-island')];
    expect(resolveIslandProps(nestedIsland!, 'mochi-props-0')).toBe('ISLAND');
    expect(resolveIslandProps(pageIsland!, 'mochi-props-0')).toBe('PAGE');
  });

  test('page island with no enclosing server island resolves via the document', () => {
    document.body.innerHTML = propsBlock('PAGE');
    const el = island();
    document.body.appendChild(el);
    expect(resolveIslandProps(el, 'mochi-props-0')).toBe('PAGE');
  });

  test('nested server islands: the innermost scope wins', () => {
    document.body.innerHTML = `
      <mochi-server-island>
        ${propsBlock('OUTER')}
        <mochi-server-island>
          ${propsBlock('INNER')}
          <mochi-hydratable-island component-name="Deep" props-ref="mochi-props-0"></mochi-hydratable-island>
        </mochi-server-island>
      </mochi-server-island>`;

    const deep = document.querySelector('mochi-hydratable-island')!;
    expect(resolveIslandProps(deep, 'mochi-props-0')).toBe('INNER');
  });

  test('missing block returns null', () => {
    const el = island();
    document.body.appendChild(el);
    expect(resolveIslandProps(el, 'mochi-props-0')).toBeNull();
  });
});
