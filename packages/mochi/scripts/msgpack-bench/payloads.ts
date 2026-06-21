/**
 * Representative island-prop payloads plus devalue's special-type cases, used by
 * the msgpackr-vs-devalue benchmark (`bench.ts`). "Representative" payloads model
 * the shapes real Mochi islands receive (config objects, record lists, text/number
 * blobs); "special" payloads exercise types that distinguish the serializers
 * (Date / Map / Set / undefined / circular & repeated references).
 */

export interface Payload {
  name: string;
  /** Short note shown in the report row. */
  note: string;
  value: unknown;
  /** Special-type payloads also drive the correctness matrix. */
  special?: boolean;
}

function makeList(n: number): unknown {
  const tagPool = ['new', 'sale', 'featured', 'limited', 'archived'];
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: i + 1,
      sku: `SKU-${(i * 7919) % 100000}`,
      name: `Product ${i + 1}`,
      price: Math.round((10 + ((i * 13) % 90)) * 100) / 100,
      inStock: i % 3 !== 0,
      rating: 1 + ((i * 7) % 50) / 10,
      tags: [tagPool[i % tagPool.length], tagPool[(i + 2) % tagPool.length]],
    });
  }
  return { items, total: n, page: 1, pageSize: n };
}

function makeNested(): unknown {
  return {
    site: { name: 'Mochi Demo', locale: 'en-US', features: { darkMode: true, beta: false, experiments: ['a', 'b', 'c'] } },
    user: { id: 42, roles: ['admin', 'editor'], prefs: { density: 'compact', notifications: { email: true, push: false, digest: 'weekly' } } },
    nav: {
      primary: [
        { label: 'Home', href: '/' },
        {
          label: 'Docs',
          href: '/docs',
          children: [
            { label: 'Intro', href: '/docs/intro' },
            { label: 'API', href: '/docs/api' },
          ],
        },
      ],
    },
  };
}

function makeNumbers(): unknown {
  const series: number[] = [];
  for (let i = 0; i < 500; i++) {
    series.push(Math.round(Math.sin(i / 9) * 1000) / 1000);
  }
  const coords: [number, number][] = [];
  for (let i = 0; i < 200; i++) {
    coords.push([Math.round(Math.cos(i / 5) * 1000) / 1000, Math.round(Math.sin(i / 5) * 1000) / 1000]);
  }
  return { series, coords };
}

const MARKDOWN =
  `# Heading\n\nThis is a **string-heavy** payload modeling rich text passed to an island. It contains *emphasis*, [links](https://example.com), and \`inline code\`.\n\n- bullet one\n- bullet two with a longer line that wraps and repeats common words like the, and, of, to, a, in\n- bullet three\n\n> A blockquote with some prose. The quick brown fox jumps over the lazy dog. `.repeat(
    6,
  );

function makeCircular(): unknown {
  const node: Record<string, unknown> = { id: 'root', label: 'Root node' };
  const child: Record<string, unknown> = { id: 'child', label: 'Child', parent: node };
  node.child = child;
  node.self = node;
  return node;
}

function makeRepeated(): unknown {
  const shared = { theme: 'dark', accent: '#ff5d8f', radius: 8 };
  return { header: shared, sidebar: shared, footer: shared, list: [shared, shared, shared] };
}

export const REPRESENTATIVE: Payload[] = [
  { name: 'small', note: 'tiny props object (a handful of primitives)', value: { title: 'Dashboard', count: 7, enabled: true, theme: 'dark' } },
  { name: 'list-50', note: 'array of 50 uniform record objects', value: makeList(50) },
  { name: 'nested-config', note: 'deeply nested config object', value: makeNested() },
  { name: 'string-heavy', note: 'markdown/HTML text blob', value: { content: MARKDOWN } },
  { name: 'number-heavy', note: '500-point series + 200 coord pairs', value: makeNumbers() },
];

export const SPECIAL: Payload[] = [
  { name: 'date', note: 'Date instance', value: { createdAt: new Date('2026-06-21T12:34:56.000Z'), updatedAt: new Date(0) }, special: true },
  {
    name: 'map',
    note: 'Map instance',
    value: {
      byId: new Map<string, unknown>([
        ['a', { n: 1 }],
        ['b', { n: 2 }],
      ]),
    },
    special: true,
  },
  { name: 'set', note: 'Set instance', value: { tags: new Set(['x', 'y', 'z']) }, special: true },
  { name: 'undefined', note: 'explicit undefined property', value: { a: 1, b: undefined, c: [1, undefined, 3] }, special: true },
  { name: 'circular', note: 'circular reference (node.self / parent)', value: makeCircular(), special: true },
  { name: 'repeated', note: 'one object referenced from many places', value: makeRepeated(), special: true },
];

export const ALL: Payload[] = [...REPRESENTATIVE, ...SPECIAL];
