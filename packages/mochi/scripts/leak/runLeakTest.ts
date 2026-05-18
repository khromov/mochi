import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startServer } from './serverProcess';
import { STATIC_ROUTES, buildWeightedRing, captureServerIslandHit, type RouteHit } from './routes';
import { startLoad, latenciesBetween } from './loadGen';
import { startRssPoller, steadyStateProbe, probeMemory, type RssSample, type MemoryProbe } from './sampler';
import { judge } from './analyze';
import { printReport, summarizeWorkload, writeJsonReport, type Report } from './report';

type CliArgs = {
  duration: number; // workload seconds
  rps: number;
  warmup: number; // seconds
  cooldown: number; // seconds
  port: number;
  reportDir: string;
  skipBuild: boolean;
};

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      duration: { type: 'string', default: '600' },
      rps: { type: 'string', default: '50' },
      warmup: { type: 'string', default: '60' },
      cooldown: { type: 'string', default: '60' },
      port: { type: 'string', default: '13333' },
      reportDir: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    duration: Number(values.duration),
    rps: Number(values.rps),
    warmup: Number(values.warmup),
    cooldown: Number(values.cooldown),
    port: Number(values.port),
    reportDir: values.reportDir ?? path.join(here, 'reports'),
    skipBuild: values['skip-build'] ?? false,
  };
}

async function buildSite(siteCwd: string): Promise<void> {
  console.log('[leak] Cleaning + rebuilding site (use --skip-build to skip)');
  const clean = Bun.spawn({
    cmd: ['bun', 'run', 'clean'],
    cwd: siteCwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await clean.exited) !== 0) {
    throw new Error('Site clean failed');
  }
  const build = Bun.spawn({
    cmd: ['bun', 'run', 'build'],
    cwd: siteCwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await build.exited) !== 0) {
    throw new Error('Site build failed — fix the build before re-running the leak test');
  }
}

async function main(): Promise<number> {
  const args = parseCliArgs();
  const baseUrl = `http://127.0.0.1:${args.port}`;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const siteCwd = path.join(repoRoot, 'packages/site');

  if (!args.skipBuild) {
    await buildSite(siteCwd);
  }

  console.log(`[leak] Starting server in ${siteCwd} on port ${args.port}`);
  const server = await startServer({
    cwd: siteCwd,
    port: args.port,
    env: { MOCHI_MEMORY_PROBE: '1', MODE: 'production', PORT: String(args.port) },
  });
  console.log(`[leak] Server up (pid=${server.pid})`);

  const rssSamples: RssSample[] = [];
  const stopPoller = startRssPoller(server.pid, 2000, (s) => rssSamples.push(s));

  const inProcessProbes: MemoryProbe[] = [];
  let exitCode = 0;

  try {
    // Capture server-island hit before warmup so it's in the route mix.
    console.log('[leak] Capturing server-island signed-props blob…');
    const islandHit = await captureServerIslandHit(baseUrl);
    const allRoutes: RouteHit[] = islandHit ? [...STATIC_ROUTES, islandHit] : STATIC_ROUTES;
    if (!islandHit) {
      console.warn('[leak] Could not capture server-island blob — skipping that route');
    }
    const ring = buildWeightedRing(allRoutes);

    console.log(`[leak] Warmup ${args.warmup}s @ ${args.rps} rps (discarded)`);
    await startLoad({
      baseUrl,
      routes: ring,
      rps: args.rps,
      durationMs: args.warmup * 1000,
    });

    console.log('[leak] Baseline probe (Bun.gc + steady state)');
    const baseline = await steadyStateProbe(baseUrl);
    if (baseline) {
      inProcessProbes.push(baseline);
    }

    console.log(`[leak] Workload ${args.duration}s @ ${args.rps} rps`);
    const workloadStart = Date.now();
    const probeTimer = setInterval(async () => {
      const p = await probeMemory(baseUrl);
      if (p) {
        inProcessProbes.push(p);
      }
    }, 60_000);

    const stats = await startLoad({
      baseUrl,
      routes: ring,
      rps: args.rps,
      durationMs: args.duration * 1000,
    });
    const workloadEnd = Date.now();
    clearInterval(probeTimer);

    console.log(`[leak] Cooldown ${args.cooldown}s`);
    await Bun.sleep(args.cooldown * 1000);

    console.log('[leak] Final probe (Bun.gc + steady state)');
    const final = await steadyStateProbe(baseUrl);
    if (final) {
      inProcessProbes.push(final);
    }

    // Trim RSS samples to the workload window, dropping a leading slice to dodge JIT warmup.
    // 30s for a real run; capped at duration/4 for short smoke tests.
    const trimMs = Math.min(30_000, Math.floor((args.duration * 1000) / 4));
    const trimStart = workloadStart + trimMs;
    const workloadSamples = rssSamples.filter((s) => s.t >= trimStart && s.t <= workloadEnd);

    if (rssSamples.length === 0) {
      throw new Error('No RSS samples collected — `ps` did not return any output for the server pid');
    }
    if (!baseline || !final) {
      throw new Error('Baseline or final memory probe failed — /__mochi/health/memory unreachable');
    }
    if (workloadSamples.length < 3) {
      console.warn(
        `[leak] Only ${workloadSamples.length} RSS sample(s) inside trimmed workload window; ` + `verdict will be unreliable. Increase --duration past 60s for meaningful results.`,
      );
    }

    // Latency creep: first vs last 60s of the workload.
    const firstWindow = latenciesBetween(stats, workloadStart, workloadStart + 60_000);
    const lastWindow = latenciesBetween(stats, workloadEnd - 60_000, workloadEnd);
    const latencyCreepPct = firstWindow.p95 > 0 ? (lastWindow.p95 / firstWindow.p95 - 1) * 100 : 0;

    const errorRate = stats.totalRequests + stats.totalErrors > 0 ? stats.totalErrors / (stats.totalRequests + stats.totalErrors) : 0;

    const verdict = judge({
      workloadSamples,
      baselineRssKb: baseline ? baseline.rss / 1024 : 0,
      finalRssKb: final ? final.rss / 1024 : 0,
      errorRate,
      latencyCreepPct,
    });

    const { leastSquares } = await import('./analyze');
    const regression = leastSquares(workloadSamples);

    const report: Report = {
      startedAt: workloadStart,
      endedAt: workloadEnd,
      config: {
        baseUrl,
        rps: args.rps,
        workloadDurationMs: args.duration * 1000,
        warmupMs: args.warmup * 1000,
        cooldownMs: args.cooldown * 1000,
      },
      baseline,
      final,
      rssSamples,
      inProcessProbes,
      regression,
      verdict,
      workloadSummary: summarizeWorkload(stats),
    };

    printReport(report);
    const file = await writeJsonReport(report, args.reportDir);
    console.log(`[leak] Full report: ${file}`);

    if (verdict.verdict === 'fail') {
      exitCode = 1;
    }
  } finally {
    stopPoller();
    await server.kill();
  }

  return exitCode;
}

const code = await main();
process.exit(code);
