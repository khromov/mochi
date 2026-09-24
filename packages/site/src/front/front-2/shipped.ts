const SCRIPT_OPEN = '<scr' + 'ipt';
const SCRIPT_CLOSE = '</scr' + 'ipt>';

export const shippedHtml = [
  '<header>…</header>',
  `${SCRIPT_OPEN} type="application/json" id="mochi-props-0">[{"count":1},5]${SCRIPT_CLOSE}`,
  '<mochi-hydratable-island',
  '  component-name="Counter"',
  '  component-url="/_mochi/client/_hydrate-Counter.js"',
  '  props-ref="mochi-props-0">',
  '  <button>Clicked 5 times</button>',
  '</mochi-hydratable-island>',
  '<footer>…</footer>',
].join('\n');
