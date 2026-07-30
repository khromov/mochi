// Offline heap-snapshot analyzer for the memtest harness. Reads the V8 snapshots
// in ./snapshots (sync them with `bun run memtest:pull`) and runs memlab over
// them, then prints a ranked summary the /memory-regression skill reads to map
// leaks to Mochi source.
//
// memlab's three-snapshot model: baseline (before the growth window) -> target
// (growth window start) -> final (growth window end). We feed it the oldest,
// midpoint, and newest local snapshots — the widest window, so a slow leak has
// room to show rather than hiding in the noise between two adjacent captures.
//
// Flags:
//   --full    print memlab's verbatim (VERBOSE) leak report only; skip our summary.
//   --growth  trend mode for slow, diffuse heap creep that findLeaks won't flag:
//             run ShapeUnboundGrowthAnalysis across the WHOLE series in ./snapshots
//             (sync it first with `bun run memtest:pull`) plus a constructor
//             count/size delta table from oldest -> newest.
//   --sha <s> / --latest-version  restrict to snapshots stamped with one git
//             short-SHA (self-updating loop writes heap-<ISO>-<sha>.heapsnapshot),
//             so a multi-version retained window is diffed WITHIN one code version.

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
// Version filter: an explicit --sha <shortsha>, or --latest-version to auto-pick
// the SHA of the newest snapshot. Empty = no filter (diff the whole flat series).
const SHA_ARG = ((): string => {
  const i = process.argv.indexOf('--sha');
  return (i >= 0 ? process.argv[i + 1] : process.env.SHA) || '';
})();
const LATEST_VERSION = process.argv.includes('--latest-version') || process.env.LATEST_VERSION === '1';

// The git short-SHA in a heap-<ISO>-<sha>.heapsnapshot name (the ISO stamp always
// ends in 'Z', so the SHA is the hex segment after it). '' for old unstamped names.
const shaOf = (base: string): string => base.match(/Z-([0-9a-fA-F]{4,40})\.heapsnapshot$/)?.[1] ?? '';

// Mirror the framework's toPosixPath() convention (packages/mochi/src/utils)
// without importing the framework into this standalone ops script: any path in
// user-facing output must render with forward slashes so it's identical on Windows.
const toPosix = (p: string): string => p.replace(/\\/g, '/');
const rel = (p: string): string => toPosix(path.relative(process.cwd(), p));

type Snap = { file: string; base: string; mtimeMs: number; sha: string };

// All .heapsnapshot files in SNAPSHOT_DIR, oldest -> newest by mtime, optionally
// restricted to one git version via --sha / --latest-version.
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
    snaps.push({ file, base: name, mtimeMs: (await stat(file)).mtimeMs, sha: shaOf(name) });
  }
  snaps.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const wantSha = SHA_ARG || (LATEST_VERSION ? (snaps[snaps.length - 1]?.sha ?? '') : '');
  if (wantSha) {
    const filtered = snaps.filter((s) => s.sha === wantSha);
    console.log(`Filtering to version ${wantSha}: ${filtered.length}/${snaps.length} snapshots.`);
    return filtered;
  }
  return snaps;
}

// Oldest / midpoint / newest of the local series — the widest baseline -> final
// window findLeaks can diff. All snapshots are local (memtest:pull mirrors the
// whole series), so the spread is picked here rather than at download time.
async function spreadThree(): Promise<[Snap, Snap, Snap]> {
  const snaps = await listSnapshots();
  if (snaps.length < 3) {
    throw new Error(`Need at least 3 .heapsnapshot files in ${rel(SNAPSHOT_DIR)}, found ${snaps.length}. ` + `Sync them with \`bun run memtest:pull\` (see memtest/README.md).`);
  }
  const baseline = snaps[0]!;
  const target = snaps[Math.floor(snaps.length / 2)]!;
  const final = snaps[snaps.length - 1]!;
  return [baseline, target, final];
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

// Classify a per-snapshot count series. memlab's "unbound growth" only means
// "never decreased", so a one-time warm-up bump (rose between snapshot 1 and 2,
// then flat) qualifies — that is NOT a leak. A real leak keeps climbing through
// the back half of the run, so that's what we test for.
function classifyTrend(counts: number[]): { sustained: boolean; plateauSnap: number | null; backHalfDelta: number } {
  const n = counts.length;
  const last = counts[n - 1] ?? 0;
  // First index of the trailing flat run (== the final value to the end).
  let plateauFrom = n - 1;
  for (let i = n - 1; i >= 0 && counts[i] === last; i--) {
    plateauFrom = i;
  }
  const mid = counts[Math.floor(n / 2)] ?? last;
  const backHalfDelta = last - mid;
  // Sustained only if still rising across the back half by more than noise.
  const sustained = backHalfDelta > Math.max(1, 0.01 * mid);
  const plateauSnap = plateauFrom < n - 1 ? plateauFrom + 1 : null; // 1-based, null if never flattens
  return { sustained, plateauSnap, backHalfDelta };
}

async function runGrowth(): Promise<void> {
  const snaps = await listSnapshots();
  if (snaps.length < 2) {
    throw new Error(`--growth needs at least 2 .heapsnapshot files in ${rel(SNAPSHOT_DIR)}, found ${snaps.length}. ` + `Sync the whole series with \`bun run memtest:pull\`.`);
  }
  const newest = snaps[snaps.length - 1]!;
  console.log(`Growth analysis over ${snaps.length} snapshots (${snaps[0]!.base} … ${newest.base}).`);
  console.log('Parsing the whole series twice — this can take a while.\n');

  // 1) memlab flags shapes whose count never decreased; we then split those into
  // sustained growth (real leak candidates) vs one-time warm-up.
  await mkdir(WORK_DIR, { recursive: true });
  const analysis = new ShapeUnboundGrowthAnalysis();
  await analysis.analyzeSnapshotsInDirectory(SNAPSHOT_DIR, { workDir: WORK_DIR });
  const shapes = analysis.getShapesWithUnboundGrowth() as Array<{ shape: string; counts?: number[]; sizes?: number[] }>;

  const classified = shapes
    .map((s) => ({ s, counts: s.counts ?? [], sizes: s.sizes ?? [], ...classifyTrend(s.counts ?? []) }))
    .sort((a, b) => (b.sizes.at(-1) ?? 0) - (a.sizes.at(-1) ?? 0));
  const sustained = classified.filter((c) => c.sustained);
  const warmup = classified.filter((c) => !c.sustained);

  const line = (c: (typeof classified)[number]): string => {
    const cTrend = `${c.counts.at(0) ?? '?'} → ${c.counts.at(-1) ?? '?'}`;
    const sTrend = `${bytes(c.sizes.at(0) ?? 0)} → ${bytes(c.sizes.at(-1) ?? 0)}`;
    const note = c.plateauSnap ? `flat since #${c.plateauSnap}` : `back-half ${c.backHalfDelta >= 0 ? '+' : ''}${c.backHalfDelta}`;
    return `  ${c.s.shape}\n      count ${cTrend} (${note})   size ${sTrend}`;
  };

  console.log(`\n=== SHAPE GROWTH (${shapes.length} flagged by memlab) ===`);
  console.log(`\nSustained growth — still climbing in the back half, real leak candidates (${sustained.length}):`);
  console.log(sustained.length ? sustained.slice(0, TOP).map(line).join('\n') : '  (none)');
  console.log(`\nWarm-up only — rose once early, then flat, NOT a leak (${warmup.length}):`);
  console.log(warmup.length ? warmup.slice(0, TOP).map(line).join('\n') : '  (none)');

  // 2) Constructor deltas from a POST-warmup snapshot to newest. The driver's
  // first snapshot is captured before load (pure warm-up), so skip it when we can
  // — otherwise the table is dominated by first-hour warm-up, not real drift.
  const cmpStart = snaps.length >= 3 ? snaps[1]! : snaps[0]!;
  const [base, fin] = [await getHeapFromFile(cmpStart.file), await getHeapFromFile(newest.file)];
  const cBase = constructorCounts(base);
  const cFin = constructorCounts(fin);
  const totalBase = [...cBase.values()].reduce((s, v) => s + v.count, 0);
  const totalFin = [...cFin.values()].reduce((s, v) => s + v.count, 0);
  const deltas = [...new Set([...cBase.keys(), ...cFin.keys()])]
    .map((name) => {
      const b = cBase.get(name) ?? { count: 0, size: 0 };
      const f = cFin.get(name) ?? { count: 0, size: 0 };
      return { name, dCount: f.count - b.count, dSize: f.size - b.size };
    })
    .filter((d) => d.dCount > 0)
    .sort((a, b) => b.dCount - a.dCount);

  const net = totalFin - totalBase;
  console.log(`\n=== CONSTRUCTOR DELTAS (post-warmup ${cmpStart.base} → newest) ===`);
  console.log(`net object nodes: ${totalBase} → ${totalFin} (${net >= 0 ? '+' : ''}${net})`);
  if (!deltas.length) {
    console.log('No constructor gained object instances after warm-up.');
  } else {
    for (const d of deltas.slice(0, TOP)) {
      console.log(`  +${String(d.dCount).padStart(7)}  ${d.name.padEnd(28)} ${bytes(d.dSize)}`);
    }
  }

  const stable = sustained.length === 0 && net <= Math.max(50, 0.005 * totalBase);
  console.log(
    stable
      ? `\nVerdict: no sustained growth after warm-up — the heap stabilizes. No leak evident in this window.`
      : `\nVerdict: ${sustained.length} shape(s) still climbing in the back half — grep them in the framework and check what keeps a reference (see the /memory-regression skill).`,
  );
}

async function main(): Promise<void> {
  if (GROWTH) {
    await runGrowth();
    return;
  }

  const [baseline, target, final] = await spreadThree();
  await mkdir(WORK_DIR, { recursive: true });

  // --full: hand off entirely to memlab's verbatim VERBOSE report — no header,
  // no summary of ours, just its full output.
  if (!FULL) {
    const fmt = (s: Snap): string => `${s.base}  (${new Date(s.mtimeMs).toISOString()})`;
    console.log('memlab heap-snapshot analysis — oldest / midpoint / newest of the local series:');
    console.log(`  baseline: ${fmt(baseline)}`);
    console.log(`  target:   ${fmt(target)}`);
    console.log(`  final:    ${fmt(final)}`);
    console.log(`  workDir:  ${rel(WORK_DIR)}\n`);
  }

  const leaks = (await findLeaksBySnapshotFilePaths(baseline.file, target.file, final.file, {
    workDir: WORK_DIR,
    ...(FULL ? { consoleMode: ConsoleMode.VERBOSE } : {}),
  })) as Array<Record<string, unknown>>;

  if (leaks.length) {
    process.exitCode = 1;
  }

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
