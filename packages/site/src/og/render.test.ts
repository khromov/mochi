import { describe, expect, test } from 'bun:test';
import { createCanvas } from '@napi-rs/canvas';
import { CARD_HEIGHT, CARD_WIDTH } from './brand.ts';
import { paintBackground } from './background.ts';
import { drawPageCard, PAGE_TITLE_FIT, PAGE_TITLE_SPEC } from './cards.ts';
import { fitText, wrapBalanced } from './layout.ts';
import { applyFont, LEDE } from './fonts.ts';
import { renderOgCard } from './render.ts';

// Each of these rasterises a full 1200x630 card and JPEG-encodes it, past bun test’s 5s default.
const RENDER_TIMEOUT = 60_000;

describe('renderOgCard', () => {
  test(
    'returns a JPEG for every kind',
    async () => {
      for (const subject of [
        { kind: 'root', title: 'Mochi' },
        { kind: 'doc', title: 'Defining routes' },
        { kind: 'blog', title: 'Mochi 0.8.0', date: '2026-06-21' },
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
    const fitted = fitText(ctx, title, PAGE_TITLE_SPEC, PAGE_TITLE_FIT);
    expect(fitted.lines).toHaveLength(expected);
    expect(fitted.spec.size).toBe(PAGE_TITLE_SPEC.size);
  });

  test('shrinks rather than overflowing, and never past the floor', () => {
    const fitted = fitText(ctx, 'A '.repeat(60).trim(), PAGE_TITLE_SPEC, PAGE_TITLE_FIT);
    expect(fitted.spec.size).toBeGreaterThanOrEqual(PAGE_TITLE_FIT.minSize);
    expect(fitted.lines.length).toBeLessThanOrEqual(PAGE_TITLE_FIT.maxLines);
    applyFont(ctx, fitted.spec);
    for (const line of fitted.lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(PAGE_TITLE_FIT.maxWidth);
    }
  });

  test('breaks a word too long for any size', () => {
    const fitted = fitText(
      ctx,
      'Supercalifragilisticexpialidociousantidisestablishmentarianism'.repeat(3),
      PAGE_TITLE_SPEC,
      PAGE_TITLE_FIT,
    );
    applyFont(ctx, fitted.spec);
    for (const line of fitted.lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(PAGE_TITLE_FIT.maxWidth);
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
