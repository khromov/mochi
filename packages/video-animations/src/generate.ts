// Mochi brand animation: renders 900 satori frames -> PNG (resvg) -> MP4 (ffmpeg).
// Run: bun run animate   (from packages/video-animations), or `bun run animate` at the repo root.
import { resolve } from 'node:path';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { prepareFonts } from './prepare-fonts';
import { loadFonts, renderFramePng } from './render';
import { CANVAS, FPS, TOTAL_FRAMES, DURATION_S } from './theme';

const OUT_DIR = resolve(import.meta.dir, '..', 'out');
const FRAMES_DIR = resolve(OUT_DIR, 'frames');
const VIDEO_PATH = resolve(OUT_DIR, 'mochi.mp4');

async function main() {
  console.log('mochi-animation: preparing fonts…');
  await prepareFonts();
  const fonts = await loadFonts();

  if (existsSync(FRAMES_DIR)) {
    rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
  mkdirSync(FRAMES_DIR, { recursive: true });

  console.log(`rendering ${TOTAL_FRAMES} frames @ ${CANVAS.width}x${CANVAS.height}…`);
  const started = Bun.nanoseconds();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const png = await renderFramePng(i / FPS, fonts);
    await Bun.write(`${FRAMES_DIR}/frame_${String(i).padStart(4, '0')}.png`, png);
    if (i % 60 === 0 || i === TOTAL_FRAMES - 1) {
      const secs = (Bun.nanoseconds() - started) / 1e9;
      console.log(`  ${i + 1}/${TOTAL_FRAMES}  (${secs.toFixed(1)}s)`);
    }
  }

  console.log('encoding mp4 with ffmpeg…');
  const proc = Bun.spawn(
    [
      'ffmpeg',
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      `${FRAMES_DIR}/frame_%04d.png`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      VIDEO_PATH,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg exited with code ${code}\n${err}`);
  }
  console.log(`\n✓ ${DURATION_S}s video → ${VIDEO_PATH}`);
}

await main();
