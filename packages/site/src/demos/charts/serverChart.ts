import path from 'node:path';
import type { Component } from 'svelte';
import { compile, compileModule, preprocess, type PreprocessorGroup } from 'svelte/compiler';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { traffic } from './data.ts';

if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as { Path2D?: unknown }).Path2D = Path2D;
}

const tsTranspiler = new Bun.Transpiler({ loader: 'ts' });
const tsPreprocessor: PreprocessorGroup = {
  name: 'demo-ts',
  script: ({ content, attributes }) => (attributes.lang === 'ts' ? { code: tsTranspiler.transformSync(content) } : undefined),
};

const svelteServerPlugin: import('bun').BunPlugin = {
  name: 'svelte-server',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path: file }) => {
      const raw = await Bun.file(file).text();
      const src = raw.includes('lang') ? (await preprocess(raw, [tsPreprocessor], { filename: file })).code : raw;
      return { contents: compile(src, { generate: 'server', filename: file }).js.code, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async ({ path: file }) => {
      const raw = await Bun.file(file).text();
      const src = file.endsWith('.ts') ? tsTranspiler.transformSync(raw) : raw;
      return { contents: compileModule(src, { generate: 'server', filename: file }).js.code, loader: 'js' };
    });
  },
};

export type ChartFormat = 'png' | 'jpeg';

type RenderOptions = { width: number; height: number; format: ChartFormat; background: string; props: Record<string, unknown>; createCanvas: (w: number, h: number) => unknown };
type ChartBundle = {
  renderChart: (component: Component, options: RenderOptions) => Uint8Array;
  ServerTrafficChart: Component;
};

let bundlePromise: Promise<ChartBundle> | undefined;
async function loadChartBundle(): Promise<ChartBundle> {
  const entry = path.join(import.meta.dir, 'serverChartBundle.ts');
  const outdir = path.join(import.meta.dir, '..', '..', '..', '.mochi', 'serverchart');
  const result = await Bun.build({
    entrypoints: [entry],
    plugins: [svelteServerPlugin],
    target: 'bun',
    conditions: ['svelte'],
    external: ['svelte', 'svelte/*'],
    outdir,
    throw: true,
  });
  const out = result.outputs.find((o) => o.kind === 'entry-point');
  if (!out) {
    throw new Error('ServerTrafficChart compile produced no entry output');
  }
  return (await import(out.path)) as ChartBundle;
}

export async function renderTrafficChart(opts: { width: number; height: number; format: ChartFormat }): Promise<Uint8Array<ArrayBuffer>> {
  bundlePromise ??= loadChartBundle();
  const { renderChart, ServerTrafficChart } = await bundlePromise;
  const bytes = renderChart(ServerTrafficChart, {
    width: opts.width,
    height: opts.height,
    format: opts.format,
    background: 'white',
    props: { data: traffic },
    createCanvas: (w, h) => createCanvas(w, h),
  });
  // Copy into an ArrayBuffer-backed view so it satisfies Response's BodyInit (a SharedArrayBuffer-backed one doesn't).
  return new Uint8Array(bytes);
}
