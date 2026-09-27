#!/usr/bin/env bun
/**
 * Structural AST diff between the `bun` and `oxc` minifier modes.
 *
 * A minifier is allowed to rename bindings and re-print expressions, but it must never change a chunk's *module
 * interface* — the imports it pulls, the names it exports, what it `import()`s at runtime, or whether it uses
 * `import.meta` / top-level `await`. Those are exactly the things that break when oxc is handed one already-split
 * chunk at a time instead of the whole program, so every emitted chunk is parsed both ways and compared on them.
 *
 * Covers each app's client bundle plus the three framework-owned scripts that go through the same pass: the inline
 * ServerIsland and LiveReload classic scripts and the standalone debug-bar bundle.
 *
 * Usage:
 *   bun scripts/check-minify-structure.ts                    # every app
 *   bun scripts/check-minify-structure.ts --apps site,demos  # a subset
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(import.meta.dir, '..');
const APPS = ['site', 'demos', 'support', 'minimal'] as const;

const { values } = parseArgs({ args: Bun.argv.slice(2), options: { apps: { type: 'string' } } });
const apps = values.apps ? values.apps.split(',').map((a) => a.trim()) : [...APPS];

/** The module-interface facts a minifier must preserve. Ordered fields stay ordered; evaluation order is observable. */
interface Shape {
  staticImports: { source: string; names: string[] }[];
  sideEffectImports: string[];
  exportNames: string[];
  starReexports: string[];
  dynamicImports: string[];
  importMetaCount: number;
  topLevelAwait: boolean;
  directives: string[];
}

function shapeOf(fileName: string, code: string, sourceType: 'module' | 'script'): Shape {
  const parsed = parseSync(fileName, code, { sourceType });
  const fatal = parsed.errors.filter((e) => e.severity === 'Error');
  if (fatal.length > 0) {
    throw new Error(`${fileName}: parse failed as ${sourceType} — ${fatal[0]!.message}`);
  }
  const mod = parsed.module;
  // A shared `chunk-<hash>.js` has no stable identity: two builds of `packages/site` with the *same* minifier
  // disagree on most of these hashes. What is comparable is how many distinct chunks a file imports and in what
  // order, so each one is renumbered by first appearance.
  const chunkAlias = new Map<string, string>();
  const source = (raw: string): string =>
    /\/chunk-[a-z0-9]+\.js$/.test(raw) ? (chunkAlias.get(raw) ?? (chunkAlias.set(raw, `<chunk#${chunkAlias.size}>`), chunkAlias.get(raw)!)) : raw;

  const staticImports: Shape['staticImports'] = [];
  const sideEffectImports: string[] = [];
  for (const imp of mod.staticImports) {
    if (imp.entries.length === 0) {
      sideEffectImports.push(source(imp.moduleRequest.value));
      continue;
    }
    // The imported name, not the local one: the local binding is exactly what a minifier is allowed to rename.
    // Sorted, because the order of specifiers *within* one import statement is not observable — only the order of
    // the import statements themselves is, and that is preserved by pushing in source order.
    staticImports.push({
      source: source(imp.moduleRequest.value),
      names: imp.entries.map((e) => (e.importName.kind === 'Name' ? `name:${e.importName.name}` : e.importName.kind)).sort(),
    });
  }

  const exportNames: string[] = [];
  const starReexports: string[] = [];
  for (const exp of mod.staticExports) {
    for (const entry of exp.entries) {
      if (entry.importName.kind === 'AllButDefault' || entry.importName.kind === 'All') {
        starReexports.push(`${entry.importName.kind}:${entry.moduleRequest ? source(entry.moduleRequest.value) : ''}`);
        continue;
      }
      const from = entry.moduleRequest ? `<-${source(entry.moduleRequest.value)}` : '';
      exportNames.push(`${entry.exportName.kind === 'None' ? 'default' : (entry.exportName.name ?? 'default')}${from}`);
    }
  }

  // `dynamicImports` carries byte offsets, so the specifier is read back out of the source. A computed specifier has
  // no literal to read and is recorded as `<expr>` — still comparable, since both builds must agree on the count.
  const dynamicImports = mod.dynamicImports.map((d) => {
    const raw = code.slice(d.moduleRequest.start, d.moduleRequest.end);
    return /^["'`]/.test(raw) ? source(raw.slice(1, -1)) : '<expr>';
  });

  const directives: string[] = [];
  for (const node of parsed.program.body) {
    const directive = (node as { directive?: string }).directive;
    if (directive === undefined) {
      break;
    }
    directives.push(directive);
  }

  return {
    staticImports,
    sideEffectImports,
    exportNames: exportNames.sort(),
    starReexports: starReexports.sort(),
    dynamicImports,
    importMetaCount: mod.importMetas.length,
    topLevelAwait: hasTopLevelAwait(parsed.program),
    directives,
  };
}

/** Walks statements without descending into anything that introduces a new `await` scope (functions, class bodies). */
function hasTopLevelAwait(program: unknown): boolean {
  const NESTED = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', 'ClassBody']);
  let found = false;
  const walk = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const type = (node as { type?: string }).type;
    if (type && NESTED.has(type)) {
      return;
    }
    if (type === 'AwaitExpression' || (type === 'ForOfStatement' && (node as { await?: boolean }).await === true)) {
      found = true;
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'type' && key !== 'start' && key !== 'end') {
        walk(value);
      }
    }
  };
  walk((program as { body: unknown }).body);
  return found;
}

const differences: string[] = [];

function compare(label: string, a: Shape, b: Shape): void {
  for (const key of Object.keys(a) as (keyof Shape)[]) {
    const left = JSON.stringify(a[key]);
    const right = JSON.stringify(b[key]);
    if (left !== right) {
      differences.push(`${label}\n    ${key}\n      bun: ${left}\n      oxc: ${right}`);
    }
  }
}

async function buildApp(appDir: string, minifier: string): Promise<void> {
  rmSync(path.join(appDir, '.mochi'), { recursive: true, force: true });
  const proc = Bun.spawn(['bun', 'run', 'build', '--', '--minifier', minifier], {
    cwd: appDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(`build failed for ${path.basename(appDir)} (minifier=${minifier}):\n${out}\n${err}`);
  }
}

function readChunks(appDir: string): Map<string, string> {
  const dir = path.join(appDir, '.mochi', 'svelte-client');
  const files = new Map<string, string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    files.set(f, readFileSync(path.join(dir, f), 'utf8'));
  }
  return files;
}

let checked = 0;

for (const app of apps) {
  const appDir = path.join(ROOT, 'packages', app);
  // Bun twice before oxc, for the same reason the browser sweep does it: `packages/site` does not build
  // reproducibly. Two consecutive `bun run build` runs with the *same* minifier disagree on 94 of 131 chunk hashes,
  // and the cross-chunk import names are Bun-mangled, so they move too. Anything the control run already changed
  // cannot be attributed to oxc, and is excluded and reported instead.
  await buildApp(appDir, 'bun');
  const bunChunks = readChunks(appDir);
  await buildApp(appDir, 'bun');
  const controlChunks = readChunks(appDir);
  await buildApp(appDir, 'oxc');
  const oxcChunks = readChunks(appDir);

  // Named entries pair on the part before the hash; anonymous `chunk-*.js` files have no stable identity at all and
  // are compared as a multiset of shapes instead.
  const named = (files: Map<string, string>) => new Map([...files].filter(([n]) => !n.startsWith('chunk-')).map(([n, c]) => [n.replace(/-[a-z0-9]+\.js$/, ''), { n, c }]));
  const anonymous = (files: Map<string, string>) => [...files].filter(([n]) => n.startsWith('chunk-'));

  const bunNamed = named(bunChunks);
  const controlNamed = named(controlChunks);
  const oxcNamed = named(oxcChunks);
  const onlyBun = [...bunNamed.keys()].filter((k) => !oxcNamed.has(k));
  const onlyOxc = [...oxcNamed.keys()].filter((k) => !bunNamed.has(k));
  if (onlyBun.length || onlyOxc.length) {
    differences.push(`${app}: entry set differs\n      only in bun: ${onlyBun.join(', ')}\n      only in oxc: ${onlyOxc.join(', ')}`);
  }
  let unstableEntries = 0;
  const checkedBefore = checked;
  for (const [key, bun] of bunNamed) {
    const oxc = oxcNamed.get(key);
    const control = controlNamed.get(key);
    if (oxc === undefined || control === undefined) {
      continue;
    }
    const bunShape = shapeOf(bun.n, bun.c, 'module');
    if (JSON.stringify(bunShape) !== JSON.stringify(shapeOf(control.n, control.c, 'module'))) {
      unstableEntries++;
      continue;
    }
    compare(`${app} :: ${key}`, bunShape, shapeOf(oxc.n, oxc.c, 'module'));
    checked++;
  }

  const fingerprint = (files: [string, string][]) => files.map(([n, c]) => JSON.stringify(shapeOf(n, c, 'module'))).sort();
  const bunAnon = fingerprint(anonymous(bunChunks));
  const controlAnon = fingerprint(anonymous(controlChunks));
  const oxcAnon = fingerprint(anonymous(oxcChunks));
  const anonStable = bunAnon.length === controlAnon.length && bunAnon.every((s, i) => s === controlAnon[i]);
  if (!anonStable) {
    console.error(`${app}: shared chunks are not reproducible between two identical builds — not compared`);
  } else if (bunAnon.length !== oxcAnon.length) {
    differences.push(`${app}: shared-chunk count differs — bun ${bunAnon.length}, oxc ${oxcAnon.length}`);
  } else {
    for (const [i, shape] of bunAnon.entries()) {
      if (shape !== oxcAnon[i]) {
        differences.push(`${app} :: shared chunk #${i}\n      bun: ${shape}\n      oxc: ${oxcAnon[i]}`);
      }
    }
    checked += bunAnon.length;
  }
  console.error(
    `${app}: compared ${checked - checkedBefore} shapes (${unstableEntries} entr${unstableEntries === 1 ? 'y' : 'ies'} excluded as not reproducible, shared chunks ${anonStable ? 'compared' : 'excluded'})`,
  );
}

// The three framework scripts that go through the same pass but are not part of an app's chunk set. The two inline
// ones are parsed as `script`, which is how the browser will parse them — a module-only construct fails here.
const { buildInlineWebComponent } = await import('../packages/mochi/src/compiler/buildInlineWebComponent');
const { buildDebugBarBundle } = await import('../packages/mochi/src/compiler/buildDebugBarBundle');

for (const rel of ['./web-components/ServerIsland.ts', './web-components/LiveReload.ts']) {
  const name = path.basename(rel, '.ts');
  const [bunJs, oxcJs] = [await buildInlineWebComponent(rel, 'bun'), await buildInlineWebComponent(rel, 'oxc')];
  compare(`inline :: ${name} (classic script)`, shapeOf(name, bunJs, 'script'), shapeOf(name, oxcJs, 'script'));
  checked++;
}

const { resolveSvelteCompiler } = await import('../packages/mochi/src/compiler/svelteCompilerBackend');
const backend = await resolveSvelteCompiler();
for (const development of [false, true]) {
  const label = development ? 'dev' : 'prod';
  const [bunBar, oxcBar] = [await buildDebugBarBundle({ development, backend, minifier: 'bun' }), await buildDebugBarBundle({ development, backend, minifier: 'oxc' })];
  compare(`debug-bar :: ${label}`, shapeOf('debugbar.js', bunBar.contents, 'module'), shapeOf('debugbar.js', oxcBar.contents, 'module'));
  checked++;
}
console.error('inline scripts + debug bar: compared 4');

if (differences.length > 0) {
  console.error(`\n❌ ${differences.length} structural difference(s) across ${checked} chunks:\n`);
  for (const d of differences) {
    console.error(`  ${d}\n`);
  }
  process.exit(1);
}
console.log(`\n✅ ${checked} chunks structurally identical between the bun and oxc minifiers.`);
