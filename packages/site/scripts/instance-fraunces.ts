import subsetFont from 'subset-font';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../../..');
const fontsDir = resolve(dirname(new URL(import.meta.url).pathname), '../src/og/fonts');

const normalSrc = resolve(root, 'node_modules/.bun/@fontsource-variable+fraunces@5.2.9/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2');
const italicSrc = resolve(root, 'node_modules/.bun/@fontsource-variable+fraunces@5.2.9/node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2');

const allChars = [
  ...new Set(
    (
      '🍡 mochi' +
      'A new SSR-first framework for Svelte 5 and Bun.' +
      'Partial Hydration · Best-in-class performance · full SSR support · Forms · Realtime WebSockets and SSE' +
      'mochi.fast'
    ).split(''),
  ),
].join('');

interface InstanceOpts {
  src: string;
  out: string;
  weight: number;
  variationAxes?: Record<string, number>;
}

async function instance({ src, out, variationAxes }: InstanceOpts) {
  const buf = await Bun.file(src).arrayBuffer();
  const result = await subsetFont(Buffer.from(buf), allChars, {
    targetFormat: 'sfnt',
    ...(variationAxes ? { variationAxes } : {}),
  });
  await Bun.write(resolve(fontsDir, out), result);
  console.log(`wrote ${out} (${result.byteLength} bytes)`);
}

await instance({
  src: normalSrc,
  out: 'fraunces-og-display.otf',
  weight: 400,
  variationAxes: { opsz: 144, SOFT: 50, WONK: 1, wght: 400 },
});
await instance({
  src: normalSrc,
  out: 'fraunces-og-normal.otf',
  weight: 400,
  variationAxes: { opsz: 9, SOFT: 0, WONK: 0, wght: 400 },
});
await instance({
  src: italicSrc,
  out: 'fraunces-og-italic.otf',
  weight: 300,
  variationAxes: { opsz: 9, SOFT: 0, WONK: 0, wght: 300 },
});
console.log('done');
