// Re-instances Fraunces (and JetBrains Mono) over a full ASCII charset with the
// brand variation axes pinned, so the animation can use any copy without hitting
// the OG card's narrow glyph subset. Mirrors packages/site/scripts/instance-fraunces.ts
// (on the og-rendering branch) but with a complete character set.
import subsetFont from 'subset-font';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '../../..');
const FONTS_DIR = import.meta.dir + '/fonts';

const SRC = {
  frauncesNormal: resolve(ROOT, 'node_modules/.bun/@fontsource-variable+fraunces@5.2.9/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2'),
  frauncesItalic: resolve(ROOT, 'node_modules/.bun/@fontsource-variable+fraunces@5.2.9/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2'),
  jetbrainsMono: resolve(ROOT, 'node_modules/.bun/@fontsource+jetbrains-mono@5.2.8/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'),
};

// Printable ASCII plus the typographic glyphs the brand copy uses (· em dash, curly quotes).
let CHARSET = '';
for (let c = 0x20; c <= 0x7e; c++) {
  CHARSET += String.fromCharCode(c);
}
CHARSET += '·—–’‘“”…';

interface Job {
  src: string;
  out: string;
  axes?: Record<string, number>;
}

const JOBS: Job[] = [
  // Display: the playful logo cut — large optical size, soft terminals, WONK on.
  { src: SRC.frauncesNormal, out: 'fraunces-display.otf', axes: { opsz: 144, SOFT: 50, WONK: 1, wght: 400 } },
  // Body text: small optical size, neutral.
  { src: SRC.frauncesNormal, out: 'fraunces-normal.otf', axes: { opsz: 9, SOFT: 0, WONK: 0, wght: 400 } },
  // Italic dek.
  { src: SRC.frauncesItalic, out: 'fraunces-italic.otf', axes: { opsz: 9, SOFT: 0, WONK: 0, wght: 300 } },
  // Monospace for the URL / code flavour. No variation axes.
  { src: SRC.jetbrainsMono, out: 'jetbrains-mono.otf' },
];

export async function prepareFonts({ force = false } = {}): Promise<void> {
  for (const job of JOBS) {
    const outPath = resolve(FONTS_DIR, job.out);
    if (!force && existsSync(outPath)) {
      continue;
    }
    const buf = await Bun.file(job.src).arrayBuffer();
    const result = await subsetFont(Buffer.from(buf), CHARSET, {
      targetFormat: 'sfnt',
      ...(job.axes ? { variationAxes: job.axes } : {}),
    });
    await Bun.write(outPath, result);
    console.log(`  font: ${job.out} (${result.byteLength} bytes)`);
  }
}

if (import.meta.main) {
  await prepareFonts({ force: true });
  console.log('fonts ready');
}
