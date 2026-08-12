import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createCanvas } from '@napi-rs/canvas';
import { CARD_HEIGHT, CARD_WIDTH } from './brand.ts';
import { paintBackground } from './background.ts';
import { drawPageCard, drawRootCard } from './cards.ts';
import { fitText, wrapBalanced } from './layout.ts';
import { applyFont, LEDE } from './fonts.ts';
import { compareBand, grainDeviation, imageData, lowPassError, pixels } from './diff.ts';
import { renderOgCard } from './render.ts';

// Each of these rasterises a full 1200x630 card and JPEG-encodes it, which is well past bun
// test’s 5s default when the suite runs files in parallel.
const RENDER_TIMEOUT = 60_000;

const REFERENCE = path.join(import.meta.dir, '__fixtures__', 'og-reference.png');

async function renderRoot() {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  await paintBackground(ctx);
  await drawRootCard(ctx);
  return { ctx, pixels: pixels(ctx) };
}

/** Ink is measured inside a generous window so a drifted band is still found and reported. */
const BANDS = [
  { label: 'wordmark', window: { x0: 340, x1: 880, y0: 100, y1: 250 }, expected: { x0: 378, x1: 823, y0: 114, y1: 240 } },
  { label: 'lede line 1', window: { x0: 240, x1: 960, y0: 266, y1: 320 }, expected: { x0: 306, x1: 895, y0: 276, y1: 311 } },
  { label: 'lede line 2', window: { x0: 240, x1: 960, y0: 328, y1: 380 }, expected: { x0: 381, x1: 819, y0: 337, y1: 371 } },
  { label: 'url', window: { x0: 440, x1: 760, y0: 496, y1: 530 }, expected: { x0: 530, x1: 669, y0: 504, y1: 520 } },
];

describe('the root card reproduces og-default.png', () => {
  test(
    'background colour and grain',
    async () => {
      const { pixels: mine } = await renderRoot();
      const reference = await imageData(REFERENCE);

      // Skip the middle, where the type sits — this asserts the gradient and the noise only.
      const { mae, max } = lowPassError(mine, reference, (x, y) => y > 100 && y < 540 && x > 230 && x < 970);
      expect(mae).toBeLessThan(1);
      expect(max).toBeLessThan(4);

      for (const [x, y] of [
        [600, 20],
        [40, 560],
        [1100, 300],
      ]) {
        expect(grainDeviation(mine, x!, y!)).toBeCloseTo(grainDeviation(reference, x!, y!), 0);
      }
    },
    RENDER_TIMEOUT,
  );

  test.each(BANDS)(
    '$label lands on the reference',
    async ({ label, window, expected }) => {
      const { pixels: mine } = await renderRoot();
      const report = compareBand(label, mine, window, expected);
      expect(report.drift).toBeLessThanOrEqual(2);
    },
    RENDER_TIMEOUT,
  );

  // The reference's dek was set in Georgia: `OgPage.svelte` never imported Fraunces' italic file, so
  // the browser fell through the stack. The card uses the Fraunces italic the CSS actually asks for,
  // which no system font on the production image could supply anyway — so only the baselines match.
  test(
    'the dek sits on the reference baselines',
    async () => {
      const { pixels: mine } = await renderRoot();
      for (const [window, expected] of [
        [
          { x0: 200, x1: 1000, y0: 398, y1: 440 },
          { y0: 407, y1: 435 },
        ],
        [
          { x0: 200, x1: 1000, y0: 442, y1: 486 },
          { y0: 449, y1: 477 },
        ],
      ] as const) {
        const report = compareBand('dek', mine, window, { ...expected, x0: 0, x1: 0 });
        expect(report.y0).toBe(expected.y0);
        expect(report.y1).toBe(expected.y1);
      }
    },
    RENDER_TIMEOUT,
  );
});

describe('renderOgCard', () => {
  test(
    'returns a JPEG for every kind',
    async () => {
      for (const subject of [
        { kind: 'root', title: 'Mochi' },
        { kind: 'doc', title: 'Defining routes' },
        { kind: 'blog', title: 'Mochi 0.8.0' },
        { kind: 'demo', title: 'Hello World' },
      ] as const) {
        const bytes = await renderOgCard(subject);
        expect(bytes.byteLength).toBeGreaterThan(10_000);
        expect(Array.from(bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
      }
    },
    RENDER_TIMEOUT,
  );

  test(
    'is deterministic, so the ETag means something',
    async () => {
      const [a, b] = await Promise.all([renderOgCard({ kind: 'doc', title: 'Caching' }), renderOgCard({ kind: 'doc', title: 'Caching' })]);
      expect(Bun.SHA256.hash(a, 'hex')).toBe(Bun.SHA256.hash(b, 'hex'));
    },
    RENDER_TIMEOUT,
  );

  test(
    'a title that cannot fit still renders',
    async () => {
      const bytes = await renderOgCard({ kind: 'doc', title: 'Supercalifragilisticexpialidocious'.repeat(6) });
      expect(bytes.byteLength).toBeGreaterThan(10_000);
    },
    RENDER_TIMEOUT,
  );
});

describe('layout', () => {
  const ctx = createCanvas(CARD_WIDTH, CARD_HEIGHT).getContext('2d');
  const CONTENT = 1056;

  test('balances a two-line title instead of leaving a runt', () => {
    applyFont(ctx, LEDE);
    const lines = wrapBalanced(ctx, 'Coming from SvelteKit and other frameworks', 620);
    expect(lines).toHaveLength(2);
    const widths = lines.map((line) => ctx.measureText(line).width);
    expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThan(200);
  });

  test.each([
    ['Routing', 1],
    ['Server-only imports and the .server.svelte convention', 2],
  ])('%s fits on %i line(s) at full size', (title, expected) => {
    const fitted = fitText(ctx, title, { ...LEDE, size: 76 }, { maxWidth: CONTENT, maxLines: 3, minSize: 42, leading: 1.14 });
    expect(fitted.lines).toHaveLength(expected);
    expect(fitted.spec.size).toBe(76);
  });

  test('shrinks rather than overflowing, and never past the floor', () => {
    const fitted = fitText(ctx, 'A '.repeat(60).trim(), { ...LEDE, size: 76 }, { maxWidth: CONTENT, maxLines: 3, minSize: 42, leading: 1.14 });
    expect(fitted.spec.size).toBeGreaterThanOrEqual(42);
    expect(fitted.lines.length).toBeLessThanOrEqual(3);
    applyFont(ctx, fitted.spec);
    for (const line of fitted.lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(CONTENT);
    }
  });

  test('breaks a word too long for any size', () => {
    const fitted = fitText(
      ctx,
      'Supercalifragilisticexpialidociousantidisestablishmentarianism'.repeat(3),
      { ...LEDE, size: 76 },
      {
        maxWidth: CONTENT,
        maxLines: 3,
        minSize: 42,
        leading: 1.14,
      },
    );
    applyFont(ctx, fitted.spec);
    for (const line of fitted.lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(CONTENT);
    }
    // U+2010 has no glyph in Fraunces' latin subset and would rasterise as tofu.
    expect(fitted.lines.join('')).not.toContain('‐');
  });

  test('the page card draws without throwing for an empty title', async () => {
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const target = canvas.getContext('2d');
    await paintBackground(target);
    await expect(drawPageCard(target, { title: '', kicker: 'Documentation' })).resolves.toBeUndefined();
  });
});
