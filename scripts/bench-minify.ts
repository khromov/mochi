#!/usr/bin/env bun
/**
 * Benchmark `Mochi.serve({ minifier })` across the workspace's apps: build each one once per minifier, then report
 * client-JS size (raw/gzip/brotli), largest chunk, and median build time as deltas against the `bun` baseline.
 *
 * Usage:
 *   bun scripts/bench-minify.ts                        # all apps, 3 runs each
 *   bun scripts/bench-minify.ts --apps site,demos      # a subset
 *   bun scripts/bench-minify.ts --runs 5               # more timing samples
 *   bun scripts/bench-minify.ts --out bench.md         # also write the table to a file
 */
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
// Bun exposes gzip natively but not Brotli, which is what a CDN actually serves these chunks as.
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const ROOT = path.resolve(import.meta.dir, '..');

/** Apps whose `build` script runs `mochi-framework build`, largest first. */
const APPS = ['site', 'demos', 'support', 'minimal'] as const;
const MINIFIERS = ['bun', 'oxc'] as const;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    apps: { type: 'string' },
    runs: { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    readFileSync(import.meta.path, 'utf8')
      .split('*/')[0]!
      .replace(/^#!.*\n/, ''),
  );
  process.exit(0);
}

const apps = values.apps ? values.apps.split(',').map((a) => a.trim()) : [...APPS];
const runs = Number(values.runs ?? 3);

interface Measurement {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  largestChunk: number;
  largestChunkName: string;
  chunkCount: number;
  medianMs: number;
  runsMs: number[];
  boots: boolean;
}

function clientJsFiles(appDir: string): string[] {
  const dir = path.join(appDir, '.mochi', 'svelte-client');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(dir, f));
}

function measureOutput(appDir: string): Omit<Measurement, 'medianMs' | 'runsMs' | 'boots'> {
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  let largestChunk = 0;
  let largestChunkName = '';
  const files = clientJsFiles(appDir);
  for (const file of files) {
    const buf = readFileSync(file);
    rawBytes += buf.byteLength;
    gzipBytes += Bun.gzipSync(buf).byteLength;
    brotliBytes += brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength;
    if (buf.byteLength > largestChunk) {
      largestChunk = buf.byteLength;
      largestChunkName = path.basename(file);
    }
  }
  return { rawBytes, gzipBytes, brotliBytes, largestChunk, largestChunkName, chunkCount: files.length };
}

async function runBuild(appDir: string, minifier: string): Promise<number> {
  const t0 = performance.now();
  const proc = Bun.spawn(['bun', 'run', 'build', '--', '--minifier', minifier], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const [code, stderr, stdout] = await Promise.all([proc.exited, new Response(proc.stderr).text(), new Response(proc.stdout).text()]);
  const ms = performance.now() - t0;
  if (code !== 0) {
    throw new Error(`build failed for ${path.basename(appDir)} (minifier=${minifier}):\n${stdout}\n${stderr}`);
  }
  return ms;
}

/**
 * Boot the built app in production mode, render its home page, and fetch every client asset that page references, so a
 * bundle that minified into something unservable is caught rather than just weighed.
 */
async function bootCheck(appDir: string, port: number): Promise<boolean> {
  const proc = Bun.spawn(['bun', 'src/index.ts'], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), MOCHI_ORIGIN: `http://localhost:${port}`, ADMIN_PASSWORD: 'bench', SMTP_HOST: 'localhost' },
  });
  const base = `http://localhost:${port}`;
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      await Bun.sleep(150);
      try {
        up = (await fetch(`${base}/health`)).ok;
      } catch {
        // not listening yet
      }
      if (proc.exitCode !== null) {
        return false;
      }
    }
    if (!up) {
      return false;
    }
    // Trailing slash, because the apps that set `trailingSlash: 'always'` would answer a bare path with a redirect.
    const home = await fetch(`${base}/`, { redirect: 'follow' });
    if (!home.ok) {
      return false;
    }
    const html = await home.text();
    const assets = [...new Set([...html.matchAll(/["'](\/_mochi\/client\/[\w.-]+\.js)["']/g)].map((m) => m[1]!))];
    const fetched = await Promise.all(assets.map((a) => fetch(base + a).then((r) => r.ok)));
    return fetched.every(Boolean);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function delta(value: number, base: number): string {
  if (value === base) {
    return '—';
  }
  const d = value - base;
  return `${d > 0 ? '+' : ''}${d.toLocaleString('en-US')} B (${((d / base) * 100).toFixed(2)}%)`;
}

const results = new Map<string, Map<string, Measurement>>();
let port = 4600;

for (const app of apps) {
  const appDir = path.join(ROOT, 'packages', app);
  if (!statSync(appDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`no such app package: ${app}`);
  }
  const perMinifier = new Map<string, Measurement>();
  for (const minifier of MINIFIERS) {
    const runsMs: number[] = [];
    for (let i = 0; i < runs; i++) {
      rmSync(path.join(appDir, '.mochi'), { recursive: true, force: true });
      runsMs.push(await runBuild(appDir, minifier));
    }
    const sizes = measureOutput(appDir);
    const boots = await bootCheck(appDir, port++);
    perMinifier.set(minifier, { ...sizes, medianMs: median(runsMs), runsMs, boots });
    console.error(`${app} / ${minifier}: ${kb(sizes.rawBytes)} raw, ${kb(sizes.gzipBytes)} gzip, ${median(runsMs).toFixed(0)}ms, boots=${boots}`);
  }
  results.set(app, perMinifier);
}

const lines: string[] = [];
lines.push(`<!-- generated by \`bun scripts/bench-minify.ts --runs ${runs}\` on Bun ${Bun.version} -->`);
lines.push('');
lines.push('| App | Minifier | Chunks | JS raw | Δ raw | JS gzip | Δ gzip | JS brotli | Δ brotli | Largest chunk | Build (median of ' + runs + ') | Boots |');
lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :-: |');
for (const [app, perMinifier] of results) {
  const base = perMinifier.get('bun')!;
  for (const minifier of MINIFIERS) {
    const m = perMinifier.get(minifier)!;
    lines.push(
      `| ${minifier === 'bun' ? `**${app}**` : ''} | \`${minifier}\`${minifier === 'bun' ? ' (baseline)' : ''} | ${m.chunkCount} | ${kb(m.rawBytes)} | ${delta(m.rawBytes, base.rawBytes)} | ${kb(m.gzipBytes)} | ${delta(m.gzipBytes, base.gzipBytes)} | ${kb(m.brotliBytes)} | ${delta(m.brotliBytes, base.brotliBytes)} | ${kb(m.largestChunk)} | ${m.medianMs.toFixed(0)} ms | ${m.boots ? '✅' : '❌'} |`,
    );
  }
}

const table = lines.join('\n');
console.log(`\n${table}\n`);
if (values.out) {
  await Bun.write(path.resolve(values.out), `${table}\n`);
  console.error(`wrote ${values.out}`);
}
