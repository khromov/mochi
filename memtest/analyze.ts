// Offline heap-snapshot analyzer for the memtest harness. Picks the newest
// three V8 snapshots in ./snapshots (captured by driver.ts or pulled manually
// from /_heapsnapshot) and runs memlab's leak detector over them, then prints a
// ranked summary the /memory-regression skill reads to map leaks to Mochi source.
//
// memlab's three-snapshot model: baseline (before the growth window) -> target
// (growth window start) -> final (growth window end). Objects allocated between
// baseline and target that survive into final are candidate leaks, clustered by
// their retainer trace. Newest-three-by-mtime approximates that ordering.
//
// Flags:
//   --full    print memlab's verbatim (VERBOSE) leak report only; skip our summary.
//   --growth  trend mode for slow, diffuse heap creep that findLeaks won't flag:
//             run ShapeUnboundGrowthAnalysis across the WHOLE series in ./snapshots
//             (pull it first with `bun run memtest:pull-all`) plus a constructor
//             count/size delta table from oldest -> newest.

import path from 'node:path';
import { readdir, stat, mkdir } from 'node:fs/promises';
import type { IHeapSnapshot, IHeapNode } from '@memlab/api';
import { findLeaksBySnapshotFilePaths, ConsoleMode, ShapeUnboundGrowthAnalysis, getHeapFromFile } from '@memlab/api';

const ROOT = path.join(import.meta.dir, '..');
const SNAPSHOT_DIR = path.resolve(process.env.SNAPSHOT_DIR || path.join(ROOT, 'snapshots'));
const WORK_DIR = process.env.MEMLAB_WORK_DIR || path.join(ROOT, '.memtest-out', 'analyze');
const FULL = process.argv.includes('--full') || process.env.FULL === '1';
const GROWTH = process.argv.includes('--growth') || process.env.GROWTH === '1';
const TOP = Number(process.env.TOP) || 10;

// Mirror the framework's toPosixPath() convention (packages/mochi/src/utils)
// without importing the framework into this standalone ops script: any path in
// user-facing output must render with forward slashes so it's identical on Windows.
const toPosix = (p: string): string => p.replace(/\\/g, '/');
const rel = (p: string): string => toPosix(path.relative(process.cwd(), p));

type Snap = { file: string; base: string; mtimeMs: number };

// All .heapsnapshot files in SNAPSHOT_DIR, oldest -> newest by mtime.
async function listSnapshots(): Promise<Snap[]> {
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
  snaps.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return snaps;
}

async function newestThree(): Promise<[Snap, Snap, Snap]> {
  const snaps = await listSnapshots();
  if (snaps.length < 3) {
    throw new Error(`Need at least 3 .heapsnapshot files in ${rel(SNAPSHOT_DIR)}, found ${snaps.length}. ` + `Capture more with the memtest harness (see memtest/README.md).`);
  }
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
  const a = Math.abs(v);
  if (!Number.isFinite(v)) {
    return '? B';
  }
  const sign = v < 0 ? '-' : '';
  if (a < 1024) {
    return `${sign}${a} B`;
  }
  if (a < 1024 * 1024) {
    return `${sign}${(a / 1024).toFixed(1)} KB`;
  }
  return `${sign}${(a / 1024 / 1024).toFixed(2)} MB`;
}

// Object-node population grouped by constructor name (self size summed). Uses the
// lightweight heap (no retained-size pass) — plenty for a count/size delta.
function constructorCounts(snapshot: IHeapSnapshot): Map<string, { count: number; size: number }> {
  const m = new Map<string, { count: number; size: number }>();
  snapshot.nodes.forEach((node: IHeapNode) => {
    if (node.type !== 'object') {
      return;
    }
    const name = node.name || '(anonymous)';
    const e = m.get(name) ?? { count: 0, size: 0 };
    e.count += 1;
    e.size += node.self_size;
    m.set(name, e);
  });
  return m;
}

async function runGrowth(): Promise<void> {
  const snaps = await listSnapshots();
  if (snaps.length < 2) {
    throw new Error(`--growth needs at least 2 .heapsnapshot files in ${rel(SNAPSHOT_DIR)}, found ${snaps.length}. ` + `Pull the whole series with \`bun run memtest:pull-all\`.`);
  }
  const oldest = snaps[0]!;
  const newest = snaps[snaps.length - 1]!;
  console.log(`Growth analysis over ${snaps.length} snapshots (${oldest.base} … ${newest.base}).`);
  console.log('Parsing the whole series twice — this can take a while.\n');

  // 1) Shapes whose object count/size climbs monotonically across the series.
  await mkdir(WORK_DIR, { recursive: true });
  const analysis = new ShapeUnboundGrowthAnalysis();
  await analysis.analyzeSnapshotsInDirectory(SNAPSHOT_DIR, { workDir: WORK_DIR });
  const shapes = analysis.getShapesWithUnboundGrowth() as Array<{ shape: string; counts?: number[]; sizes?: number[] }>;

  console.log(`\n=== SHAPES WITH UNBOUND GROWTH (${shapes.length}) ===`);
  if (!shapes.length) {
    console.log('No object shape grew monotonically across every snapshot.');
  } else {
    // Biggest final retained size first.
    shapes.sort((a, b) => (b.sizes?.at(-1) ?? 0) - (a.sizes?.at(-1) ?? 0));
    for (const s of shapes.slice(0, TOP)) {
      const counts = s.counts ?? [];
      const sizes = s.sizes ?? [];
      const cTrend = `${counts.at(0) ?? '?'} → ${counts.at(-1) ?? '?'}`;
      const sTrend = `${bytes(sizes.at(0) ?? 0)} → ${bytes(sizes.at(-1) ?? 0)}`;
      console.log(`  ${s.shape}`);
      console.log(`      count ${cTrend}   size ${sTrend}`);
    }
  }

  // 2) Which constructors accumulated the most between the oldest and newest snapshot.
  const [base, fin] = [await getHeapFromFile(oldest.file), await getHeapFromFile(newest.file)];
  const cBase = constructorCounts(base);
  const cFin = constructorCounts(fin);
  const deltas = [...new Set([...cBase.keys(), ...cFin.keys()])]
    .map((name) => {
      const b = cBase.get(name) ?? { count: 0, size: 0 };
      const f = cFin.get(name) ?? { count: 0, size: 0 };
      return { name, dCount: f.count - b.count, dSize: f.size - b.size };
    })
    .filter((d) => d.dCount > 0)
    .sort((a, b) => b.dCount - a.dCount);

  console.log(`\n=== TOP CONSTRUCTOR DELTAS (oldest → newest) ===`);
  if (!deltas.length) {
    console.log('No constructor gained object instances across the window.');
  } else {
    for (const d of deltas.slice(0, TOP)) {
      console.log(`  +${String(d.dCount).padStart(7)}  ${d.name.padEnd(28)} ${bytes(d.dSize)}`);
    }
  }

  console.log(
    `\nA shape/constructor that climbs every snapshot is the leak candidate — grep it in the framework and check what keeps a reference (see the /memory-regression skill).`,
  );
}

async function main(): Promise<void> {
  if (GROWTH) {
    await runGrowth();
    return;
  }

  const [baseline, target, final] = await newestThree();
  await mkdir(WORK_DIR, { recursive: true });

  // --full: hand off entirely to memlab's verbatim VERBOSE report — no header,
  // no summary of ours, just its full output.
  if (!FULL) {
    const fmt = (s: Snap): string => `${s.base}  (${new Date(s.mtimeMs).toISOString()})`;
    console.log('memlab heap-snapshot analysis — newest 3 by mtime:');
    console.log(`  baseline: ${fmt(baseline)}`);
    console.log(`  target:   ${fmt(target)}`);
    console.log(`  final:    ${fmt(final)}`);
    console.log(`  workDir:  ${rel(WORK_DIR)}\n`);
  }

  const leaks = (await findLeaksBySnapshotFilePaths(baseline.file, target.file, final.file, {
    workDir: WORK_DIR,
    ...(FULL ? { consoleMode: ConsoleMode.VERBOSE } : {}),
  })) as Array<Record<string, unknown>>;

  if (FULL) {
    return;
  }

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
