import type { SKRSContext2D } from '@napi-rs/canvas';
import { applyFont, type FontSpec } from './fonts.ts';

const measure = (ctx: SKRSContext2D, text: string) => ctx.measureText(text).width;

/** Greedy wrap. Candidates are measured whole, never as a sum of word widths — every spec here has
 * non-zero tracking, and kerning across the space matters at display sizes. */
export function wrapGreedy(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let line = words[0]!;
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (measure(ctx, candidate) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Approximates `text-wrap: balance` the way browsers do — by narrowing the measuring width until the
 * ragged edge evens out, never by shrinking the type. Binary-searches the tightest width that still
 * wraps to the same number of lines.
 */
export function wrapBalanced(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const target = wrapGreedy(ctx, text, maxWidth);
  if (target.length < 2) {
    return target;
  }
  let low = Math.max(...target.map((line) => measure(ctx, line))) / target.length;
  let high = maxWidth;
  let best = target;
  for (let i = 0; i < 12 && high - low > 1; i++) {
    const mid = (low + high) / 2;
    const candidate = wrapGreedy(ctx, text, mid);
    if (candidate.length <= target.length) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

/** Splits a word too long to fit at any size. Uses a plain hyphen — Fraunces' latin subset has no
 * U+2010, so the typographic one rasterises as tofu. */
export function breakLongWord(ctx: SKRSContext2D, word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let rest = word;
  while (measure(ctx, rest) > maxWidth && rest.length > 1) {
    let take = 1;
    while (take < rest.length && measure(ctx, `${rest.slice(0, take + 1)}-`) <= maxWidth) {
      take++;
    }
    parts.push(`${rest.slice(0, take)}-`);
    rest = rest.slice(take);
  }
  parts.push(rest);
  return parts;
}

export function truncate(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (measure(ctx, text) <= maxWidth) {
    return text;
  }
  let end = text.length;
  while (end > 0 && measure(ctx, `${text.slice(0, end).trimEnd()}…`) > maxWidth) {
    end--;
  }
  return `${text.slice(0, end).trimEnd()}…`;
}

export interface FitOptions {
  maxWidth: number;
  maxLines: number;
  minSize: number;
  /** Line height as a multiple of the font size. */
  leading: number;
}

export interface FittedText {
  lines: string[];
  spec: FontSpec;
  leading: number;
}

/**
 * Steps the size down until the text fits `maxLines`. `opsz` has to track the size on every step —
 * that is what `font-optical-sizing: auto` does in a browser, and leaving it pinned would change the
 * letterforms as the title shrinks.
 */
export function fitText(ctx: SKRSContext2D, text: string, base: FontSpec, opts: FitOptions): FittedText {
  for (let size = base.size; size >= opts.minSize; size -= 2) {
    const spec = { ...base, size, opsz: size };
    applyFont(ctx, spec);
    const lines = wrapBalanced(ctx, text, opts.maxWidth);
    if (lines.length <= opts.maxLines && lines.every((line) => measure(ctx, line) <= opts.maxWidth)) {
      return { lines, spec, leading: size * opts.leading };
    }
  }

  const spec = { ...base, size: opts.minSize, opsz: opts.minSize };
  applyFont(ctx, spec);
  const lines = wrapGreedy(ctx, text, opts.maxWidth).flatMap((line) => (measure(ctx, line) > opts.maxWidth ? breakLongWord(ctx, line, opts.maxWidth) : [line]));
  const kept = lines.slice(0, opts.maxLines);
  if (lines.length > opts.maxLines) {
    kept[opts.maxLines - 1] = truncate(ctx, `${kept[opts.maxLines - 1]} ${lines[opts.maxLines]}`, opts.maxWidth);
  }
  return { lines: kept, spec, leading: opts.minSize * opts.leading };
}
