// Quick check: render one PNG per scene so we can eyeball before the full run.
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { prepareFonts } from './prepare-fonts';
import { loadFonts, renderFramePng } from './render';

const PROBE_DIR = resolve(import.meta.dir, '../..', 'out/probe');

await prepareFonts();
const fonts = await loadFonts();

mkdirSync(PROBE_DIR, { recursive: true });
for (const t of [2.5, 8.0, 15.0, 22.0, 27.5]) {
  await Bun.write(`${PROBE_DIR}/t${t}.png`, await renderFramePng(t, fonts));
  console.log(`wrote t${t}.png`);
}
console.log('probe done');
