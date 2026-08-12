import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { CARD_HEIGHT, CARD_WIDTH } from './brand.ts';

export interface Ink {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface BandReport extends Ink {
  label: string;
  expected: Ink;
  /** Worst per-edge deviation from `expected`, in pixels. */
  drift: number;
}

export async function imageData(file: string): Promise<Uint8ClampedArray> {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(await loadImage(file), 0, 0);
  return ctx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data;
}

export function pixels(ctx: SKRSContext2D): Uint8ClampedArray {
  return ctx.getImageData(0, 0, CARD_WIDTH, CARD_HEIGHT).data;
}

const channel = (d: Uint8ClampedArray, x: number, y: number, c: number) => d[(y * CARD_WIDTH + x) * 4 + c]!;

/**
 * Mean absolute error after an 8×8 box downsample. The card's grain is per-pixel white noise that is
 * statistically — not phase — identical to the reference, so a raw per-pixel diff measures the grain
 * and nothing else. Downsampling averages it out and leaves geometry and colour.
 */
export function lowPassError(a: Uint8ClampedArray, b: Uint8ClampedArray, skip?: (x: number, y: number) => boolean): { mae: number; max: number } {
  const block = 8;
  let sum = 0;
  let count = 0;
  let max = 0;
  for (let by = 0; by + block <= CARD_HEIGHT; by += block) {
    for (let bx = 0; bx + block <= CARD_WIDTH; bx += block) {
      if (skip?.(bx, by)) {
        continue;
      }
      for (let c = 0; c < 3; c++) {
        let sa = 0;
        let sb = 0;
        for (let y = by; y < by + block; y++) {
          for (let x = bx; x < bx + block; x++) {
            sa += channel(a, x, y, c);
            sb += channel(b, x, y, c);
          }
        }
        const delta = Math.abs(sa - sb) / (block * block);
        sum += delta;
        count++;
        max = Math.max(max, delta);
      }
    }
  }
  return { mae: sum / count, max };
}

/** Standard deviation of the green channel over a flat patch — the card's grain amplitude. */
export function grainDeviation(d: Uint8ClampedArray, x0: number, y0: number, size = 32): number {
  const values: number[] = [];
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      values.push(channel(d, x, y, 1));
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

/**
 * Bounding box of ink inside a window, where "ink" is anything far enough from the local background.
 * The background is sampled from the same image rather than modelled, so this works on both the
 * reference and a fresh render.
 */
export function inkBounds(d: Uint8ClampedArray, window: Ink, threshold = 45): Ink | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = window.y0; y <= window.y1; y++) {
    // The gradient runs on x+y, so a row's own margins are the right backdrop reference for it.
    const left = channel(d, window.x0, y, 1);
    const right = channel(d, window.x1, y, 1);
    for (let x = window.x0; x <= window.x1; x++) {
      const t = (x - window.x0) / Math.max(1, window.x1 - window.x0);
      const backdrop = left + (right - left) * t;
      if (Math.abs(channel(d, x, y, 1) - backdrop) > threshold) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

export function compareBand(label: string, d: Uint8ClampedArray, window: Ink, expected: Ink): BandReport {
  const found = inkBounds(d, window) ?? { x0: 0, x1: 0, y0: 0, y1: 0 };
  const drift = Math.max(Math.abs(found.x0 - expected.x0), Math.abs(found.x1 - expected.x1), Math.abs(found.y0 - expected.y0), Math.abs(found.y1 - expected.y1));
  return { label, ...found, expected, drift };
}
