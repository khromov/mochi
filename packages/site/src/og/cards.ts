import path from 'node:path';
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { SITE_ROOT } from '../lib/siteRoot.ts';
import { CARD_WIDTH, INK, INK_FAINT, INK_MUTED, SITE_HOST, WORDMARK_SIZE, WORDMARK_WORD } from './brand.ts';
import { applyFont, DEK, LEDE, URL, WORDMARK, type FontSpec } from './fonts.ts';
import { fitText, type FitOptions } from './layout.ts';

const DANGO = path.join(SITE_ROOT, 'src', 'og', 'assets', 'dango.png');

const DANGO_ART = { size: 128, x: 5, y: 5, width: 120, height: 120 } as const;

// Measured off the reference card, in em of the wordmark size.
const DANGO_INK_EM = 0.9922;
const DANGO_GAP_EM = 0.1641;
const DANGO_RISE_EM = 0.875;

let dango: Promise<Image> | undefined;

const inkWidth = (ctx: SKRSContext2D, text: string) => {
  const m = ctx.measureText(text);
  return m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
};

// The emoji is a raster: it can only come from a colour-emoji font, which Alpine has none of.
async function drawWordmark(ctx: SKRSContext2D, size: number, centreX: number, baseline: number): Promise<void> {
  applyFont(ctx, { ...WORDMARK, size });
  const word = ctx.measureText(WORDMARK_WORD);
  const glyph = size * DANGO_INK_EM;
  const total = glyph + size * DANGO_GAP_EM + word.actualBoundingBoxLeft + word.actualBoundingBoxRight;
  const left = centreX - total / 2;

  const scale = glyph / DANGO_ART.width;
  const image = await (dango ??= loadImage(DANGO));
  ctx.drawImage(image, left - DANGO_ART.x * scale, baseline - size * DANGO_RISE_EM - DANGO_ART.y * scale, DANGO_ART.size * scale, DANGO_ART.size * scale);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.fillText(WORDMARK_WORD, left + glyph + size * DANGO_GAP_EM + word.actualBoundingBoxLeft, baseline);
}

function drawCentred(ctx: SKRSContext2D, lines: string[], spec: FontSpec, firstBaseline: number, leading: number, fill: string): void {
  applyFont(ctx, spec);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fill;
  lines.forEach((line, i) => ctx.fillText(line, CARD_WIDTH / 2, firstBaseline + i * leading));
}

const ROOT_URL_SIZE = 30;

// Split exactly as text-wrap: balance broke them.
export const ROOT_LEDE = ['A new SSR-first framework', 'for Svelte 5 and Bun.'];
export const ROOT_DEK = ['Partial Hydration · Best-in-class performance · full', 'SSR support · Forms · Realtime WebSockets and SSE'];

/** Reproduces public/og-default.png. */
export async function drawRootCard(ctx: SKRSContext2D): Promise<void> {
  await drawWordmark(ctx, WORDMARK_SIZE, CARD_WIDTH / 2, 226);
  drawCentred(ctx, ROOT_LEDE, LEDE, 312, 60, INK);
  drawCentred(ctx, ROOT_DEK, DEK, 429, 42, INK_MUTED);

  applyFont(ctx, { ...URL, size: ROOT_URL_SIZE });
  ctx.textAlign = 'center';
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(SITE_HOST, CARD_WIDTH / 2, 521);
}

const PAD = 72;
const CONTENT = CARD_WIDTH - PAD * 2;
const PAGE_WORDMARK = 52;
const TITLE_TOP = 172;
const TITLE_BOTTOM = 468;
const RULE_Y = 506;
const FOOTER_BASELINE = 562;
// Larger than the root card: this row is all the context a page card gets, at thumbnail size.
const FOOTER_KICKER_SIZE = 44;
const FOOTER_URL_SIZE = 38;

export interface PageCard {
  title: string;
  kicker: string;
}

export const PAGE_TITLE_SPEC: FontSpec = { ...LEDE, size: 76 };
export const PAGE_TITLE_FIT: FitOptions = {
  maxWidth: CONTENT,
  maxLines: 3,
  minSize: 42,
  leading: 1.14,
  maxHeight: TITLE_BOTTOM - TITLE_TOP,
};

export async function drawPageCard(ctx: SKRSContext2D, { title, kicker }: PageCard): Promise<void> {
  applyFont(ctx, { ...WORDMARK, size: PAGE_WORDMARK });
  const markWidth = PAGE_WORDMARK * (DANGO_INK_EM + DANGO_GAP_EM) + inkWidth(ctx, WORDMARK_WORD);
  await drawWordmark(ctx, PAGE_WORDMARK, PAD + markWidth / 2, PAD + PAGE_WORDMARK * DANGO_RISE_EM - 6);

  const fitted = fitText(ctx, title, PAGE_TITLE_SPEC, PAGE_TITLE_FIT);
  applyFont(ctx, fitted.spec);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  const ascent = ctx.measureText(fitted.lines[0] ?? 'H').actualBoundingBoxAscent;
  const block = ascent + (fitted.lines.length - 1) * fitted.leading;
  const first = (TITLE_TOP + TITLE_BOTTOM) / 2 - block / 2 + ascent;
  fitted.lines.forEach((line, i) => ctx.fillText(line, PAD, first + i * fitted.leading));

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PAD, RULE_Y + 0.5);
  ctx.lineTo(CARD_WIDTH - PAD, RULE_Y + 0.5);
  ctx.stroke();

  if (kicker) {
    applyFont(ctx, { ...DEK, size: FOOTER_KICKER_SIZE });
    ctx.textAlign = 'left';
    ctx.fillStyle = INK_MUTED;
    ctx.fillText(kicker, PAD, FOOTER_BASELINE);
  }

  applyFont(ctx, { ...URL, size: FOOTER_URL_SIZE });
  ctx.textAlign = 'right';
  ctx.fillStyle = INK_FAINT;
  ctx.fillText(SITE_HOST, CARD_WIDTH - PAD, FOOTER_BASELINE);
}
