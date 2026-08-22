// Re-instances with a full ASCII charset (unlike the OG card's narrow subset) so the animation can use any copy; mirrors packages/site/scripts/instance-fraunces.ts (og-rendering branch).
import subsetFont from 'subset-font';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { FONTS_DIR } from './fonts-dir';

// The woff2/woff source fonts aren't in @fontsource's `exports`, so locate the package via its package.json and reach into `files/` (version-agnostic, unlike a hardcoded .bun path).
function fontSource(pkg: string, file: string): string {
  const pkgJson = Bun.resolveSync(`${pkg}/package.json`, import.meta.dir);
  return resolve(dirname(pkgJson), 'files', file);
}

const SRC = {
  frauncesNormal: fontSource('@fontsource-variable/fraunces', 'fraunces-latin-full-normal.woff2'),
  frauncesItalic: fontSource('@fontsource-variable/fraunces', 'fraunces-latin-full-italic.woff2'),
  jetbrainsMono: fontSource('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'),
};

let CHARSET = '';
for (let c = 0x20; c <= 0x7e; c++) {
  CHARSET += String.fromCharCode(c);
}
CHARSET += '·—–’‘“”…'; // extra glyphs the brand copy uses

interface Job {
  src: string;
  out: string;
  axes?: Record<string, number>;
}

const JOBS: Job[] = [
  { src: SRC.frauncesNormal, out: 'fraunces-display.otf', axes: { opsz: 144, SOFT: 50, WONK: 1, wght: 400 } },
  { src: SRC.frauncesNormal, out: 'fraunces-normal.otf', axes: { opsz: 9, SOFT: 0, WONK: 0, wght: 400 } },
  { src: SRC.frauncesItalic, out: 'fraunces-italic.otf', axes: { opsz: 9, SOFT: 0, WONK: 0, wght: 300 } },
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
