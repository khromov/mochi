import { spawn, type Subprocess } from 'bun';
import path from 'node:path';
import pc from 'picocolors';

type Args = {
  url: string;
  warmup: number;
  samples: number;
  port: number;
  out: string | null;
};

const usage = `Usage: bun run flamegraph <url> [--warmup N] [--samples N] [--port P] [--out PATH]

Spawns the site in production mode on an alt port with profiling enabled,
sends warmup requests, captures a V8 CPU profile across N sample requests,
and writes a .cpuprofile file you can drop into Chrome DevTools.

Defaults: --warmup 5  --samples 100  --port 4444

Samples = how many times the target URL is fetched while profiling. The V8
profiler samples at ~1kHz, so for fast (sub-10ms) routes you want many sample
requests to get meaningful flame graph resolution. For slow routes, reduce
--samples to keep the run short.

Open the resulting file in Chrome DevTools:
  Performance panel → drag-and-drop the .cpuprofile, OR
  ⋮ → More tools → JavaScript Profiler → Load.`;

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(usage);
      process.exit(0);
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error(`Missing value for --${key}`);
        process.exit(2);
      }
      opts[key] = next;
      i++;
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    console.error(usage);
    process.exit(2);
  }
  return {
    url: positional[0],
    warmup: opts.warmup ? Number(opts.warmup) : 5,
    samples: opts.samples ? Number(opts.samples) : 100,
    port: opts.port ? Number(opts.port) : 4444,
    out: opts.out ?? null,
  };
};

const slugFromPath = (pathname: string): string => {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return 'root';
  }
  return trimmed.replace(/\//g, '-').replace(/[^a-zA-Z0-9_-]/g, '_');
};

const isoStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');

const drainResponse = async (res: Response): Promise<void> => {
  // Read and discard so server-side streaming completes.
  await res.arrayBuffer();
};

const pipePrefixed = async (src: ReadableStream<Uint8Array>, dst: NodeJS.WriteStream, prefix: string): Promise<void> => {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of src) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      dst.write(prefix + buf.slice(0, nl) + '\n');
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.length > 0) {
    dst.write(prefix + buf + '\n');
  }
};

const waitForReady = async (origin: string, timeoutMs = 30000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(origin + '/', { redirect: 'manual' });
      await drainResponse(res);
      if (res.status < 500) {
        return;
      }
    } catch {
      // not yet listening
    }
    await Bun.sleep(150);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms at ${origin}`);
};

const killGracefully = async (proc: Subprocess): Promise<void> => {
  if (proc.exitCode !== null) {
    return;
  }
  proc.kill('SIGTERM');
  const timedOut = await Promise.race([proc.exited.then(() => false as const), Bun.sleep(3000).then(() => true as const)]);
  if (timedOut && proc.exitCode === null) {
    proc.kill('SIGKILL');
    await proc.exited;
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const target = new URL(args.url);
  const altOrigin = `http://localhost:${args.port}`;
  const targetUrl = `${altOrigin}${target.pathname}${target.search}`;

  const repoRoot = path.resolve(import.meta.dir, '..');
  const siteCwd = path.join(repoRoot, 'packages', 'site');

  const env = { ...process.env, PORT: String(args.port), MOCHI_PROFILER: '1', FORCE_COLOR: '1' };
  delete env.MODE;

  console.log(pc.cyan(`[flamegraph] spawning site on port ${args.port} (production mode, MOCHI_PROFILER=1)`));
  const proc = spawn({
    cmd: ['bun', 'src/index.ts'],
    cwd: siteCwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });
  const prefix = pc.gray('[server] ');
  void pipePrefixed(proc.stdout as ReadableStream<Uint8Array>, process.stdout, prefix);
  void pipePrefixed(proc.stderr as ReadableStream<Uint8Array>, process.stderr, prefix);

  const onExit = async (signal: NodeJS.Signals): Promise<never> => {
    console.log(pc.yellow(`[flamegraph] received ${signal}, tearing down server`));
    await killGracefully(proc);
    process.exit(1);
  };
  process.on('SIGINT', () => void onExit('SIGINT'));
  process.on('SIGTERM', () => void onExit('SIGTERM'));

  try {
    await waitForReady(altOrigin);
    console.log(pc.cyan(`[flamegraph] server ready, warming up (${args.warmup} requests)`));

    for (let i = 0; i < args.warmup; i++) {
      const res = await fetch(targetUrl, { redirect: 'manual' });
      await drainResponse(res);
    }

    console.log(pc.cyan(`[flamegraph] starting profiler`));
    const startRes = await fetch(`${altOrigin}/_profiler/start`);
    if (!startRes.ok) {
      throw new Error(`/_profiler/start returned ${startRes.status}`);
    }
    await drainResponse(startRes);

    console.log(pc.cyan(`[flamegraph] sampling ${args.samples} request(s) to ${target.pathname}`));
    const tStart = performance.now();
    for (let i = 0; i < args.samples; i++) {
      const res = await fetch(targetUrl, { redirect: 'manual' });
      await drainResponse(res);
    }
    const tEnd = performance.now();
    console.log(pc.cyan(`[flamegraph] sampling complete in ${(tEnd - tStart).toFixed(0)}ms`));

    const stopRes = await fetch(`${altOrigin}/_profiler/stop`);
    if (!stopRes.ok) {
      throw new Error(`/_profiler/stop returned ${stopRes.status}`);
    }
    const profile = (await stopRes.json()) as { nodes: unknown[]; samples: number[]; startTime: number; endTime: number };

    const outPath = args.out ?? path.join(repoRoot, 'flamegraphs', `${slugFromPath(target.pathname)}-${isoStamp()}.cpuprofile`);
    await Bun.write(outPath, JSON.stringify(profile));

    const rel = path.relative(process.cwd(), outPath);
    const profileMs = (profile.endTime - profile.startTime) / 1000;
    console.log(pc.green(`[flamegraph] profile: ${profile.samples.length} samples, ${profile.nodes.length} nodes, ${profileMs.toFixed(1)}ms captured`));
    if (profile.samples.length < 50) {
      console.log(pc.yellow(`[flamegraph] few samples — bump --samples for better resolution (e.g. --samples 500)`));
    }
    console.log(pc.green(`[flamegraph] wrote ${rel}`));
    console.log(pc.green(`[flamegraph] open in Chrome DevTools: Performance panel → drag-and-drop, or ⋮ → More tools → JavaScript Profiler → Load`));
  } finally {
    await killGracefully(proc);
  }
};

await main();
