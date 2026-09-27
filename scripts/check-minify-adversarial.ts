#!/usr/bin/env bun
/**
 * Runs the adversarial fixture under both minifier modes in a real browser and asserts the two produce identical
 * results. Everything here targets a failure mode the size benchmark cannot see: oxc minifies one already-split chunk
 * at a time, so anything whose meaning spans a chunk boundary — a live `export let`, a circular import, the order of
 * side-effect-only imports — or anything that looks removable but is not — a bare property read that Svelte uses as a
 * dependency, a getter with a side effect — is where a second pass goes wrong.
 *
 * Two halves:
 *   1. `plain/` — a hand-split ES module graph exercising cross-chunk semantics and modern syntax, loaded as a module
 *      script. No framework involved, so a failure points straight at the minifier.
 *   2. `AdversarialPage.svelte` — real Mochi islands covering Svelte 5 reactivity, served from a live `Mochi.serve()`.
 *
 * Usage: bun scripts/check-minify-adversarial.ts
 */
import { chromium, type ConsoleMessage } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { minifyBuildOutputs, type MochiJsMinifier } from '../packages/mochi/src/compiler/jsMinifier';

const FIXTURES = path.resolve(import.meta.dir, '..', 'packages', 'mochi', 'src', '__fixtures__', 'minify-adversarial');
const MINIFIERS: MochiJsMinifier[] = ['bun', 'oxc'];

const failures: string[] = [];

/** Both runs get their own ephemeral port, and stack frames quote it, so the origin has to come out before diffing. */
function normalize(text: string): string {
  return text.replace(/https?:\/\/localhost:\d+/g, 'http://host');
}

function check(label: string, bun: unknown, oxc: unknown): void {
  const a = JSON.stringify(bun, null, 1);
  const b = JSON.stringify(oxc, null, 1);
  if (a !== b) {
    failures.push(`${label}\n    bun: ${a}\n    oxc: ${b}`);
  }
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- 1. plain module graph

/** Build the fixture graph with splitting on, so the cross-chunk cases actually cross a chunk. */
async function buildPlain(minifier: MochiJsMinifier, outDir: string): Promise<Map<string, string>> {
  const result = await Bun.build({
    entrypoints: [path.join(FIXTURES, 'plain', 'entry.js')],
    outdir: outDir,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    naming: '[name]-[hash].[ext]',
    throw: false,
  });
  if (!result.success) {
    throw new Error(`plain fixture build failed (${minifier}):\n${result.logs.map(String).join('\n')}`);
  }
  const reminified = await minifyBuildOutputs(result.outputs, minifier);
  const files = new Map<string, string>();
  for (const out of result.outputs) {
    files.set(path.basename(out.path), reminified?.get(out.path) ?? (await out.text()));
  }
  const entry = result.outputs.find((o) => o.kind === 'entry-point')!;
  files.set('__entry__', path.basename(entry.path));
  return files;
}

interface PlainRun {
  results: unknown;
  errors: string[];
  chunkCount: number;
  legalCommentsKept: number;
}

async function runPlain(minifier: MochiJsMinifier): Promise<PlainRun> {
  const outDir = mkdtempSync(path.join(FIXTURES, `.out-${minifier}-`));
  try {
    const files = await buildPlain(minifier, outDir);
    const entryName = files.get('__entry__')!;
    files.delete('__entry__');
    const legalCommentsKept = [...files.values()].reduce((n, code) => n + (code.match(/\/\*![\s\S]*?\*\//g)?.length ?? 0), 0);

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = new URL(req.url).pathname.slice(1);
        if (name === '') {
          return new Response(`<!doctype html><meta charset="utf-8"><script type="module">import {results} from "./${entryName}"; window.__results = results;</script>`, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        const body = files.get(name);
        return body === undefined ? new Response('nf', { status: 404 }) : new Response(body, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
      },
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(normalize(`pageerror: ${e.message}`)));
    page.on('console', (m: ConsoleMessage) => m.type() === 'error' && errors.push(normalize(`console: ${m.text()}`)));
    try {
      await page.goto(server.url.href, { waitUntil: 'load' });
      await page.waitForFunction(() => (window as unknown as { __results?: unknown }).__results !== undefined, null, { timeout: 15_000 });
      const results = await page.evaluate(() => (window as unknown as { __results: unknown }).__results);
      return { results, errors, chunkCount: files.size, legalCommentsKept };
    } finally {
      await page.close();
      server.stop(true);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const plain: Record<string, PlainRun> = {};
for (const m of MINIFIERS) {
  plain[m] = await runPlain(m);
  console.error(`plain/${m}: ${plain[m]!.chunkCount} chunks, ${plain[m]!.errors.length} errors, ${plain[m]!.legalCommentsKept} legal comments`);
}
// The full result object is worth seeing when adding a case, but it is 60 lines of noise on a normal run.
if (process.env.MOCHI_MINIFY_DUMP) {
  console.error(JSON.stringify(plain.bun!.results, null, 1));
}
check('plain :: runtime results', plain.bun!.results, plain.oxc!.results);
check('plain :: page errors', plain.bun!.errors, plain.oxc!.errors);
check('plain :: chunk count', plain.bun!.chunkCount, plain.oxc!.chunkCount);
check('plain :: legal comments preserved', plain.bun!.legalCommentsKept, plain.oxc!.legalCommentsKept);
if (plain.bun!.errors.length > 0) {
  failures.push(`plain :: the fixture itself errors under bun, so the comparison is meaningless:\n    ${plain.bun!.errors.join('\n    ')}`);
}

// ---------------------------------------------------------------- 2. Svelte islands

interface SvelteRun {
  beforeClick: Record<string, string>;
  afterClick: Record<string, string>;
  lazy: string;
  errors: string[];
}

async function runSvelte(minifier: MochiJsMinifier): Promise<SvelteRun> {
  const outDir = mkdtempSync(path.resolve(import.meta.dir, '..', 'packages', 'mochi', `.mochi-adversarial-${minifier}-`));
  const { ComponentRegistry } = await import('../packages/mochi/src/compiler/ComponentRegistry');
  const registry = new ComponentRegistry({ development: false, debugBar: false, outDir, minifier });
  const pagePath = path.join(FIXTURES, 'AdversarialPage.svelte');
  try {
    await registry.compileAll([pagePath]);
    const errs = registry.getErrors();
    if (errs.length > 0) {
      throw new Error(`adversarial page failed to compile: ${JSON.stringify(errs)}`);
    }
    const rendered = await registry.renderComponent(pagePath, {});
    const clientPrefix = '/_mochi/client/';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        const asset = registry.getClientFile(pathname);
        if (asset !== undefined) {
          return new Response(asset, { headers: { 'Content-Type': pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' } });
        }
        if (!pathname.startsWith(clientPrefix)) {
          const bootstrap = rendered.bootstrapUrl ? `<script type="module" src="${rendered.bootstrapUrl}"></script>` : '';
          return new Response(`<!doctype html><meta charset="utf-8"><body>${rendered.body}${bootstrap}`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return new Response('nf', { status: 404 });
      },
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(normalize(`pageerror: ${e.message}`)));
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(normalize(`console(${m.type()}): ${m.text()}`)));
    const readOutputs = () =>
      page.evaluate(() => Object.fromEntries([...document.querySelectorAll('output[data-testid]')].map((el) => [el.getAttribute('data-testid')!, el.textContent!.trim()])));
    try {
      await page.goto(server.url.href, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('[data-testid="lazy-island"]')?.textContent?.trim() === 'lazy-ok', null, { timeout: 15_000 });
      const beforeClick = await readOutputs();
      await page.click('[data-testid="run"]');
      // Svelte flushes effects on a microtask, so read back only once the counter the click drives has advanced.
      await page.waitForFunction(() => document.querySelector('[data-testid="class-field"]')?.textContent?.trim() !== '1', null, { timeout: 15_000 });
      const afterClick = await readOutputs();
      return { beforeClick, afterClick, lazy: afterClick['lazy-island'] ?? '', errors };
    } finally {
      await page.close();
      server.stop(true);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const svelte: Record<string, SvelteRun> = {};
for (const m of MINIFIERS) {
  svelte[m] = await runSvelte(m);
  console.error(`svelte/${m}: ${JSON.stringify(svelte[m]!.afterClick)} errors=${svelte[m]!.errors.length}`);
}
check('svelte :: outputs before interaction', svelte.bun!.beforeClick, svelte.oxc!.beforeClick);
check('svelte :: outputs after interaction', svelte.bun!.afterClick, svelte.oxc!.afterClick);
check('svelte :: console/page errors', svelte.bun!.errors, svelte.oxc!.errors);

// Reactivity must actually have fired, or "identical" would just mean "identically broken".
for (const m of MINIFIERS) {
  const after = svelte[m]!.afterClick;
  for (const key of ['bare-read', 'nested', 'class-field', 'private-getter']) {
    if (Number(after[key]) < 2) {
      failures.push(`svelte/${m} :: effect "${key}" never re-ran after the state change (value ${after[key]})`);
    }
  }
  if (svelte[m]!.errors.length > 0) {
    failures.push(`svelte/${m} :: browser reported errors:\n    ${svelte[m]!.errors.join('\n    ')}`);
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} adversarial difference(s):\n`);
  for (const f of failures) {
    console.error(`  ${f}\n`);
  }
  process.exit(1);
}
console.log('\n✅ adversarial fixture behaves identically under both minifiers.');
