import { resolve } from 'node:path';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { prepareFonts } from './prepare-fonts';
import { loadFonts, renderFramePng } from './render';
import { CANVAS, FPS, TOTAL_FRAMES, DURATION_S } from './theme';

const OUT_DIR = resolve(import.meta.dir, '..', 'out');
const FRAMES_DIR = resolve(OUT_DIR, 'frames');
const VIDEO_PATH = resolve(OUT_DIR, 'mochi.mp4');
const AUDIO_PATH = resolve(import.meta.dir, '..', 'audio', 'bounce-bay-records-traditional-japanese-2-437931.mp3');

// Fade the soundtrack out over the final stretch so the video ends on silence.
const AUDIO_FADE_S = 3;

const WORKERS = Math.max(1, Number(process.env.VIDEO_WORKERS ?? 4));

function logProgress(done: number, started: number) {
  if (done % 60 === 0 || done === TOTAL_FRAMES) {
    const secs = (Bun.nanoseconds() - started) / 1e9;
    console.log(`  ${done}/${TOTAL_FRAMES}  (${secs.toFixed(1)}s)`);
  }
}

// Single-threaded fallback (VIDEO_WORKERS=1).
async function renderInline() {
  const fonts = await loadFonts();
  const started = Bun.nanoseconds();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const png = await renderFramePng(i / FPS, fonts);
    await Bun.write(`${FRAMES_DIR}/frame_${String(i).padStart(4, '0')}.png`, png);
    logProgress(i + 1, started);
  }
}

async function renderParallel() {
  const workerUrl = new URL('./render-worker.ts', import.meta.url).href;
  const started = Bun.nanoseconds();
  let done = 0;

  await Promise.all(
    Array.from(
      { length: WORKERS },
      (_, id) =>
        new Promise<void>((resolveJob, rejectJob) => {
          const worker = new Worker(workerUrl, { type: 'module' });
          worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as { type: string; message?: string };
            if (msg.type === 'progress') {
              logProgress(++done, started);
            } else if (msg.type === 'done') {
              worker.terminate();
              resolveJob();
            } else if (msg.type === 'error') {
              worker.terminate();
              rejectJob(new Error(`worker ${id}: ${msg.message}`));
            }
          };
          worker.onerror = (e) => {
            worker.terminate();
            rejectJob(e.error instanceof Error ? e.error : new Error(`worker ${id} crashed`));
          };
          worker.postMessage({ id, workers: WORKERS, total: TOTAL_FRAMES, framesDir: FRAMES_DIR });
        }),
    ),
  );
}

async function encode() {
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
      '-i',
      AUDIO_PATH,
      '-af',
      `afade=t=out:st=${DURATION_S - AUDIO_FADE_S}:d=${AUDIO_FADE_S}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'slow',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      // Audio runs longer than the frame sequence; clip the muxed output to the video.
      '-shortest',
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
}

async function main() {
  console.log('mochi-animation: preparing fonts…');
  await prepareFonts();

  if (existsSync(FRAMES_DIR)) {
    rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
  mkdirSync(FRAMES_DIR, { recursive: true });

  console.log(`rendering ${TOTAL_FRAMES} frames @ ${CANVAS.width}x${CANVAS.height} across ${WORKERS} worker${WORKERS > 1 ? 's' : ''}…`);
  if (WORKERS > 1) {
    await renderParallel();
  } else {
    await renderInline();
  }

  console.log('encoding mp4 with ffmpeg…');
  await encode();

  // The frames are only an intermediate for ffmpeg; drop them once the mp4 exists.
  rmSync(FRAMES_DIR, { recursive: true, force: true });

  console.log(`\n✓ ${DURATION_S}s video → ${VIDEO_PATH}`);
}

await main();
