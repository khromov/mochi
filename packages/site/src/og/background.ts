import path from 'node:path';
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { SITE_ROOT } from '../lib/siteRoot.ts';
import { CARD_HEIGHT, CARD_WIDTH, GRADIENT_ANGLE_DEG, GRADIENT_FROM, GRADIENT_TO, NOISE_TILE_SIZE } from './brand.ts';

const NOISE_TILE = path.join(SITE_ROOT, 'src', 'og', 'assets', 'noise-240.png');

/**
 * Chrome's `background-blend-mode` lands ~30% shy of the amplitude Skia's `soft-light` produces from
 * the same tile, so the capture is flattened toward its own mean to match the reference card's
 * measured grain (sd 3.03 on the green channel). Scaling around the mean leaves the tile's ~+15/255
 * lift over the gradient untouched.
 */
const GRAIN_CONTRAST = 0.81;

let tile: Promise<Canvas> | undefined;

async function noiseTile(): Promise<Canvas> {
  const image = await loadImage(NOISE_TILE);
  const canvas = createCanvas(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(0, 0, NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  let total = 0;
  for (let i = 0; i < data.data.length; i += 4) {
    total += data.data[i]!;
  }
  const mean = total / (data.data.length / 4);
  for (let i = 0; i < data.data.length; i += 4) {
    const value = mean + (data.data[i]! - mean) * GRAIN_CONTRAST;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/**
 * CSS gradient-line geometry: the line runs through the box centre at `angle`, and its length is the
 * projection of the box onto it, so the stops land on the corners rather than the edges.
 */
function gradientLine(width: number, height: number, angleDeg: number): [number, number, number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const [cx, cy] = [width / 2, height / 2];
  return [cx - (dx * length) / 2, cy - (dy * length) / 2, cx + (dx * length) / 2, cy + (dy * length) / 2];
}

/**
 * Paints `linear-gradient(135deg, …)` with the grain tiled over it at `soft-light`, matching the
 * `.og-canvas` / `.hero` background. The tile is a capture of the `feTurbulence` layer, so it already
 * carries the linearRGB→sRGB conversion SVG filters apply by default — which is where the card's
 * background gets its ~15/255 lift over the bare gradient stops.
 */
export async function paintBackground(ctx: SKRSContext2D): Promise<void> {
  const gradient = ctx.createLinearGradient(...gradientLine(CARD_WIDTH, CARD_HEIGHT, GRADIENT_ANGLE_DEG));
  gradient.addColorStop(0, GRADIENT_FROM);
  gradient.addColorStop(1, GRADIENT_TO);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const noise = ctx.createPattern(await (tile ??= noiseTile()), 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = noise;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.restore();
}
