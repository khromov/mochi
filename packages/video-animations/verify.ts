import { loadFonts, renderFramePng } from './src/render';
import { prepareFonts } from './src/prepare-fonts';
import { FPS } from './src/theme';
import { mkdirSync, rmSync } from 'node:fs';
await prepareFonts();
const fonts = await loadFonts();
const DIR = '/tmp/verify'; rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const N = 150;
for (let i = 0; i < N; i++) {
  await Bun.write(`${DIR}/f_${String(i).padStart(4, '0')}.png`, await renderFramePng(i / FPS, fonts));
  if (i % 50 === 0) console.log(`${i}/${N}`);
}
console.log('done');
