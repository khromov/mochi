// Offline heap-snapshot analyzer for the memtest harness. Picks the newest
// three V8 snapshots in ./snapshots (captured by driver.ts or pulled manually
// from /_heapsnapshot) and runs memlab's leak detector over them, then prints a
// ranked summary the /memory-regression skill reads to map leaks to Mochi source.
//
// memlab's three-snapshot model: baseline (before the growth window) -> target
// (growth window start) -> final (growth window end). Objects allocated between
// baseline and target that survive into final are candidate leaks, clustered by
// their retainer trace. Newest-three-by-mtime approximates that ordering.

import path from 'node:path';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { findLeaksBySnapshotFilePaths } from '@memlab/api';

const ROOT = path.join(import.meta.dir, '..');
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || path.join(ROOT, 'snapshots');
const WORK_DIR = process.env.MEMLAB_WORK_DIR || path.join(ROOT, '.memtest-out', 'analyze');
const TOP = Number(process.env.TOP) || 10;

// Mirror the framework's toPosixPath() convention (packages/mochi/src/utils)
// without importing the framework into this standalone ops script: any path in
// user-facing output must render with forward slashes so it's identical on Windows.
const toPosix = (p: string): string => p.replace(/\\/g, '/');
const rel = (p: string): string => toPosix(path.relative(process.cwd(), p));

type Snap = { file: string; base: string; mtimeMs: number };

async function newestThree(): Promise<[Snap, Snap, Snap]> {
  let names: string[];
  try {
    names = await readdir(SNAPSHOT_DIR);
  } catch {
    throw new Error(`Snapshot directory not found: ${rel(SNAPSHOT_DIR)} (set SNAPSHOT_DIR to override)`);
  }
  const snaps: Snap[] = [];
  for (const name of names) {
    if (!name.endsWith('.heapsnapshot')) {
      continue;
    }
    const file = path.join(SNAPSHOT_DIR, name);
    snaps.push({ file, base: name, mtimeMs: (await stat(file)).mtimeMs });
  }
  if (snaps.length < 3) {
    throw new Error(`Need at least 3 .heapsnapshot files in ${rel(SNAPSHOT_DIR)}, found ${snaps.length}. ` + `Capture more with the memtest harness (see memtest/README.md).`);
  }
  snaps.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const [baseline, target, final] = snaps.slice(-3);
  return [baseline!, target!, final!];
}

// Each item memlab returns is a serialized retainer-trace path keyed by
// "0: <leaked object> $retained-size:<bytes> @<id>", "1: --edge--> <node>", ...
// The index-0 entry is the leaked object itself. Parse it into what leaked, how
// big it is retained, and its node id — everything else lives in memlab's own
// console report (full trace) and the per-trace JSON files under the workDir.
type Leak = { name: string; size: number; id: string };

function parseLeak(trace: Record<string, unknown>): Leak {
  const key = Object.keys(trace).find((k) => /^\d+:/.test(k)) ?? '';
  const size = Number(key.match(/\$retained-size:(\d+)/)?.[1] ?? 0);
  const id = key.match(/@(\d+)/)?.[1] ?? '';
  // Name is the text after "N:" up to the first memlab tag ($…) or the @id.
  const name =
    key
      .replace(/^\d+:\s*/, '')
      .split(/\s+\$|\s+@/)[0]
      ?.trim() || '(anonymous)';
  return { name, size, id: id ? `@${id}` : '' };
}

function bytes(v: number): string {
  if (!Number.isFinite(v) || v <= 0) {
    return '? B';
  }
  if (v < 1024) {
    return `${v} B`;
  }
  if (v < 1024 * 1024) {
    return `${(v / 1024).toFixed(1)} KB`;
  }
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  const [baseline, target, final] = await newestThree();
  await mkdir(WORK_DIR, { recursive: true });

  const fmt = (s: Snap): string => `${s.base}  (${new Date(s.mtimeMs).toISOString()})`;
  console.log('memlab heap-snapshot analysis — newest 3 by mtime:');
  console.log(`  baseline: ${fmt(baseline)}`);
  console.log(`  target:   ${fmt(target)}`);
  console.log(`  final:    ${fmt(final)}`);
  console.log(`  workDir:  ${rel(WORK_DIR)}\n`);

  const leaks = (await findLeaksBySnapshotFilePaths(baseline.file, target.file, final.file, {
    workDir: WORK_DIR,
  })) as Array<Record<string, unknown>>;

  console.log(`\n=== SUMMARY ===`);
  if (!leaks.length) {
    console.log('No leak clusters detected across the three snapshots.');
    return;
  }

  // Biggest retained objects lead — that's where a growing heap is concentrated.
  const ranked = leaks.map(parseLeak).sort((a, b) => b.size - a.size);
  const total = ranked.reduce((sum, r) => sum + r.size, 0);

  console.log(`${leaks.length} leak trace(s), ~${bytes(total)} retained across their leaked objects.`);
  console.log(`Top ${Math.min(TOP, ranked.length)} by retained size:\n`);
  ranked.slice(0, TOP).forEach((l, i) => {
    console.log(`  ${i + 1}. ${l.name} — ${bytes(l.size)}${l.id ? `  ${l.id}` : ''}`);
  });

  console.log(
    `\nFull retainer traces (leaked object → GC root) are in memlab's report above ` +
      `and as per-trace JSON under ${rel(WORK_DIR)}/. Map each leaked object's retainer ` +
      `chain back to Mochi source to find what's holding it.`,
  );
}

main().catch((err) => {
  console.error(`analyze failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
