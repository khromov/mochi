import path from 'node:path';
import { compile, compileModule } from 'svelte/compiler';
import { createCanvas, Path2D, GlobalFonts } from '@napi-rs/canvas';
import { traffic } from './data.ts';

// renderChart draws the marks with Path2D and expects it on globalThis.
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as { Path2D?: unknown }).Path2D = Path2D;
}

// layerchart's canvas renderer falls back to the `sans-serif` family, which Alpine (the
// production base image) can't resolve because it ships no fonts — so axis labels rasterize
// blank. Register the site's UI font under that family name so text renders everywhere.
function fontFile(pkg: string, file: string): string {
  return path.resolve(path.dirname(Bun.resolveSync(`${pkg}/package.json`, import.meta.dir)), 'files', file);
}
GlobalFonts.registerFromPath(fontFile('@fontsource/public-sans', 'public-sans-latin-400-normal.woff2'), 'sans-serif');

export type ChartFormat = 'png' | 'jpeg';

type ChartBundle = {
  renderChart: (
    component: unknown,
    options: { width: number; height: number; format: ChartFormat; background: string; props: object; createCanvas: (w: number, h: number) => unknown },
  ) => Uint8Array;
  ServerTrafficChart: unknown;
};

// Mochi can't import `.svelte` in server code, so compile the ServerChart tree to a JS bundle here.
// `.svelte.js` rune modules (layerchart's chart state) need compileModule, not compile.
const svelteServerPlugin: import('bun').BunPlugin = {
  name: 'svelte-server',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path: f }) => ({
      contents: compile(await Bun.file(f).text(), { generate: 'server', filename: f }).js.code,
      loader: 'js',
    }));
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async ({ path: f }) => ({
      contents: compileModule(await Bun.file(f).text(), { generate: 'server', filename: f }).js.code,
      loader: 'js',
    }));
  },
};

let bundle: Promise<ChartBundle> | undefined;
async function loadBundle(): Promise<ChartBundle> {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, 'serverChartBundle.ts')],
    plugins: [svelteServerPlugin],
    target: 'bun',
    conditions: ['svelte'],
    external: ['svelte', 'svelte/*'],
    outdir: path.join(import.meta.dir, '..', '..', '..', '.mochi', 'serverchart'),
    throw: true,
  });
  return import(result.outputs[0]!.path) as Promise<ChartBundle>;
}

export async function renderTrafficChart(opts: { width: number; height: number; format: ChartFormat }): Promise<Uint8Array<ArrayBuffer>> {
  const { renderChart, ServerTrafficChart } = await (bundle ??= loadBundle());
  const bytes = renderChart(ServerTrafficChart, {
    width: opts.width,
    height: opts.height,
    format: opts.format,
    background: 'white',
    props: { data: traffic },
    createCanvas,
  });
  // Copy into an ArrayBuffer-backed view so it satisfies Response's BodyInit.
  return new Uint8Array(bytes);
}
