import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { LoadStats } from './loadGen';
import type { MemoryProbe, RssSample } from './sampler';
import type { Regression, VerdictDetail } from './analyze';

export type Report = {
  startedAt: number;
  endedAt: number;
  config: {
    baseUrl: string;
    rps: number;
    workloadDurationMs: number;
    warmupMs: number;
    cooldownMs: number;
  };
  baseline: MemoryProbe | null;
  final: MemoryProbe | null;
  rssSamples: RssSample[];
  inProcessProbes: MemoryProbe[];
  regression: Regression;
  verdict: VerdictDetail;
  workloadSummary: {
    totalRequests: number;
    totalErrors: number;
    p50Ms: number;
    p95Ms: number;
    perRoute: Array<{
      name: string;
      count: number;
      errors: number;
      p50Ms: number;
      p95Ms: number;
      status2xx: number;
      status3xx: number;
      status4xx: number;
      status5xx: number;
    }>;
  };
};

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) {
    return 0;
  }
  const idx = Math.min(arr.length - 1, Math.floor((arr.length - 1) * p));
  return arr[idx] ?? 0;
}

export function summarizeWorkload(stats: LoadStats): Report['workloadSummary'] {
  const allLat: number[] = [];
  const perRoute: Report['workloadSummary']['perRoute'] = [];
  for (const r of stats.byRoute.values()) {
    const lats = r.samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    allLat.push(...lats);
    perRoute.push({
      name: r.name,
      count: r.count,
      errors: r.errors,
      p50Ms: percentile(lats, 0.5),
      p95Ms: percentile(lats, 0.95),
      status2xx: r.status2xx,
      status3xx: r.status3xx,
      status4xx: r.status4xx,
      status5xx: r.status5xx,
    });
  }
  allLat.sort((a, b) => a - b);
  return {
    totalRequests: stats.totalRequests,
    totalErrors: stats.totalErrors,
    p50Ms: percentile(allLat, 0.5),
    p95Ms: percentile(allLat, 0.95),
    perRoute,
  };
}

export function printReport(report: Report): void {
  const v = report.verdict;
  const baselineMb = report.baseline ? report.baseline.rss / 1024 / 1024 : 0;
  const finalMb = report.final ? report.final.rss / 1024 / 1024 : 0;

  console.log('');
  console.log('='.repeat(70));
  console.log(`Leak test verdict: ${v.verdict.toUpperCase()}`);
  console.log('='.repeat(70));
  for (const reason of v.reasons) {
    console.log(`  • ${reason}`);
  }
  console.log('');
  console.log('Memory:');
  console.log(`  baseline RSS:         ${baselineMb.toFixed(1)} MB`);
  console.log(`  final RSS:            ${finalMb.toFixed(1)} MB`);
  console.log(`  delta:                ${v.deltaMb.toFixed(1)} MB`);
  console.log(`  workload slope:       ${v.slopeMbPerMin.toFixed(2)} MB/min  (r²=${report.regression.r2.toFixed(3)}, n=${report.regression.n})`);
  console.log(`  GC dip during load:   ${v.hadGcDip ? 'yes' : 'no'}`);
  console.log('');
  console.log('Traffic:');
  console.log(`  total requests:       ${report.workloadSummary.totalRequests}`);
  console.log(`  errors:               ${report.workloadSummary.totalErrors}  (${(v.errorRate * 100).toFixed(2)}%)`);
  console.log(`  latency p50/p95:      ${report.workloadSummary.p50Ms.toFixed(1)} / ${report.workloadSummary.p95Ms.toFixed(1)} ms`);
  console.log(`  p95 creep:            ${v.latencyCreepPct.toFixed(0)}%`);
  console.log('');
  console.log('Per-route:');
  console.log(`  ${'name'.padEnd(24)} ${'count'.padStart(7)} ${'err'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'2xx/3xx/4xx/5xx'.padStart(20)}`);
  for (const r of report.workloadSummary.perRoute) {
    const status = `${r.status2xx}/${r.status3xx}/${r.status4xx}/${r.status5xx}`;
    console.log(
      `  ${r.name.padEnd(24)} ${String(r.count).padStart(7)} ${String(r.errors).padStart(5)} ${r.p50Ms.toFixed(1).padStart(7)} ${r.p95Ms.toFixed(1).padStart(7)} ${status.padStart(20)}`,
    );
  }
  console.log('='.repeat(70));
}

export async function writeJsonReport(report: Report, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const stamp = new Date(report.startedAt).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = path.join(outDir, `${stamp}.json`);
  await Bun.write(file, JSON.stringify(report, null, 2));
  return file;
}
