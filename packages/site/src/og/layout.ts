import type { SKRSContext2D } from '@napi-rs/canvas';
import { applyFont, type FontSpec } from './fonts.ts';

const measure = (ctx: SKRSContext2D, text: string) => ctx.measureText(text).width;

// Candidates are measured whole: every spec has tracking, and kerning across the space matters.
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

/** Approximates text-wrap: balance by narrowing the measuring width, never by shrinking the type. */
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

// Plain hyphen: Fraunces' latin subset has no U+2010, which rasterises as tofu.
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
  /** Ink height the block must fit in, ascender to descender. */
  maxHeight: number;
}

function blockHeight(ctx: SKRSContext2D, lines: string[], leading: number): number {
  if (lines.length === 0) {
    return 0;
  }
  const first = ctx.measureText(lines[0]!);
  const last = ctx.measureText(lines.at(-1)!);
  return first.actualBoundingBoxAscent + (lines.length - 1) * leading + last.actualBoundingBoxDescent;
}

export interface FittedText {
  lines: string[];
  spec: FontSpec;
  leading: number;
}

/** `opsz` tracks the size on every step — that is what font-optical-sizing: auto does in a browser. */
export function fitText(ctx: SKRSContext2D, text: string, base: FontSpec, opts: FitOptions): FittedText {
  for (let size = base.size; size >= opts.minSize; size -= 2) {
    const spec = { ...base, size, opsz: size };
    applyFont(ctx, spec);
    const lines = wrapBalanced(ctx, text, opts.maxWidth);
    const leading = size * opts.leading;
    const fits =
      lines.length <= opts.maxLines && lines.every((line) => measure(ctx, line) <= opts.maxWidth) && blockHeight(ctx, lines, leading) <= opts.maxHeight;
    if (fits) {
      return { lines, spec, leading };
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
