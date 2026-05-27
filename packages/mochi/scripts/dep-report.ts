#!/usr/bin/env bun
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface PkgJson {
  name?: string;
  dependencies?: Record<string, string>;
}

interface IndexEntry {
  pkg: PkgJson;
  /** Absolute path of the directory containing this package's `package.json`. */
  dir: string;
}

const ROOT = join(import.meta.dir, '..');
const REPO_ROOT = join(ROOT, '..', '..');
const BUN_STORE = join(REPO_ROOT, 'node_modules', '.bun');

/**
 * Bun's isolated install layout is `node_modules/.bun/<name>@<version>/node_modules/<name>/package.json`.
 * Scan the store once and index by package name (first hit wins on duplicates,
 * which is good enough for a counts report). For non-Bun installs (npm/pnpm hoisted)
 * fall back to scanning `node_modules/<name>/package.json` directly.
 */
async function indexPackages(): Promise<Map<string, IndexEntry>> {
  const index = new Map<string, IndexEntry>();
  // Scoped packages live one folder deeper (`<store>/<flat>/node_modules/@scope/<name>/`),
  // so we need both glob depths.
  const globs = [
    new Bun.Glob('*/node_modules/*/package.json'), // unscoped
    new Bun.Glob('*/node_modules/@*/*/package.json'), // scoped
  ];
  if (existsSync(BUN_STORE)) {
    for (const glob of globs) {
      for await (const rel of glob.scan({ cwd: BUN_STORE })) {
        const full = join(BUN_STORE, rel);
        try {
          const pkg = JSON.parse(readFileSync(full, 'utf8')) as PkgJson;
          if (pkg.name && !index.has(pkg.name)) {
            index.set(pkg.name, { pkg, dir: dirname(full) });
          }
        } catch {
          // Skip unreadable/invalid package.json files
        }
      }
    }
  }
  // Fallback: top-level node_modules for any non-isolated installs.
  const topGlobs = [
    new Bun.Glob('*/package.json'), // unscoped
    new Bun.Glob('@*/*/package.json'), // scoped
  ];
  const topNodeModules = join(REPO_ROOT, 'node_modules');
  if (existsSync(topNodeModules)) {
    for (const glob of topGlobs) {
      for await (const rel of glob.scan({ cwd: topNodeModules })) {
        const full = join(topNodeModules, rel);
        try {
          const pkg = JSON.parse(readFileSync(full, 'utf8')) as PkgJson;
          if (pkg.name && !index.has(pkg.name)) {
            index.set(pkg.name, { pkg, dir: dirname(full) });
          }
        } catch {
          // skip
        }
      }
    }
  }
  return index;
}

/**
 * Sum every file under `dir` (recursively). Skips nested `node_modules`
 * directories — those are other packages' on-disk costs and would be double-
 * counted if we walked them here. Symlinks are followed via `statSync`'s
 * default (linked-target stat), so Bun's store layout works.
 */
function dirSize(dir: string): number {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const full = join(dir, entry.name);
    try {
      const s = statSync(full);
      if (s.isDirectory()) {
        total += dirSize(full);
      } else if (s.isFile()) {
        total += s.size;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return total;
}

async function readPkg(path: string): Promise<PkgJson> {
  return JSON.parse(await Bun.file(path).text());
}

/** Walk `dependencies` (production only) starting from a direct dep. Returns the set of unique package names reached (excluding the root itself). */
function transitiveDeps(rootName: string, index: Map<string, IndexEntry>): Set<string> {
  const seen = new Set<string>();
  const queue = [rootName];
  let first = true;
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (!first && seen.has(name)) {
      continue;
    }
    if (!first) {
      seen.add(name);
    }
    first = false;
    const entry = index.get(name);
    if (!entry?.pkg.dependencies) {
      continue;
    }
    for (const dep of Object.keys(entry.pkg.dependencies)) {
      if (!seen.has(dep)) {
        queue.push(dep);
      }
    }
  }
  return seen;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const mochiPkg = await readPkg(join(ROOT, 'package.json'));
// Svelte is a peer dep, but you can't run Mochi without it — count it like a direct dep for this report.
const directDeps = [...new Set([...Object.keys(mochiPkg.dependencies ?? {}), 'svelte'])].sort();
const peerDeps = Object.keys((mochiPkg as { peerDependencies?: Record<string, string> }).peerDependencies ?? {});
const devDeps = Object.keys((mochiPkg as { devDependencies?: Record<string, string> }).devDependencies ?? {});

const index = await indexPackages();

const sizeCache = new Map<string, number>();
function sizeOf(name: string): number {
  const cached = sizeCache.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const entry = index.get(name);
  const s = entry ? dirSize(entry.dir) : 0;
  sizeCache.set(name, s);
  return s;
}

interface Row {
  dep: string;
  transitive: Set<string>;
  selfSize: number;
  totalSize: number;
}

const rows: Row[] = [];
const union = new Set<string>(directDeps);
for (const dep of directDeps) {
  const t = transitiveDeps(dep, index);
  const selfSize = sizeOf(dep);
  let totalSize = selfSize;
  for (const name of t) {
    totalSize += sizeOf(name);
  }
  rows.push({ dep, transitive: t, selfSize, totalSize });
  for (const name of t) {
    union.add(name);
  }
}

let unionSize = 0;
for (const name of union) {
  unionSize += sizeOf(name);
}

rows.sort((a, b) => b.totalSize - a.totalSize || a.dep.localeCompare(b.dep));

const totalProd = directDeps.length;
const totalTransitive = union.size;

console.log(`Direct: ${totalProd}`);
console.log(`Peer:   ${peerDeps.length} (${peerDeps.join(', ')})`);
console.log(`Dev:    ${devDeps.length}`);
console.log(`Total unique packages reachable from production deps (roots + transitive): ${totalTransitive}`);
console.log(`Total on-disk size of those packages: ${formatBytes(unionSize)}`);
console.log('');
console.log('Toplist — direct deps ranked by total size (self + transitive):');
console.log(`  ${'total'.padStart(9)}  ${'self'.padStart(9)}  ${'count'.padStart(5)}  package`);
for (const r of rows) {
  const cells = [formatBytes(r.totalSize).padStart(9), formatBytes(r.selfSize).padStart(9), r.transitive.size.toString().padStart(5), r.dep];
  console.log(`  ${cells.join('  ')}`);
}
console.log('');
console.log('Transitive breakdown for the heaviest deps:');
for (const r of rows) {
  if (r.transitive.size === 0) {
    continue;
  }
  const parts = [...r.transitive].sort().map((n) => `${n} (${formatBytes(sizeOf(n))})`);
  console.log(`\n  ${r.dep} (${r.transitive.size}, ${formatBytes(r.totalSize - r.selfSize)} transitive): ${parts.join(', ')}`);
}
