import { Glob } from 'bun';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
  /**
   * Hard per-file deadline (ms) for a child that never even finishes its tests —
   * a genuinely wedged test that never writes its result. Backstops Bun's per-*test*
   * `--timeout`, which fails a test but never forces the process to exit. A child
   * that DID finish (JUnit written) but won't exit is force-killed via `exitGraceMs`
   * long before this fires. Default 120_000.
   */
  fileTimeoutMs?: number;
  /**
   * Grace (ms) after a child writes its complete JUnit report but hasn't exited.
   * `bun test` can pass every test yet fail to drain-and-exit on Windows (a runtime
   * quirk; our own timers are unref'd). Once the report is on disk the run is done,
   * so we wait this long for a clean exit, then force-kill and take pass/fail from
   * the report. Default 8_000.
   */
  exitGraceMs?: number;
  /**
   * Poll interval (ms) for the JUnit report file. Default 150.
   */
  pollIntervalMs?: number;
  /**
   * Advanced / test-only: build the child argv for a file (before the JUnit reporter
   * flags, which are always appended). Defaults to `bun test --timeout 30000 <file>`.
   * Exposed so the supervisor's completion/force-exit logic can be driven against a
   * controllable fake child — Bun force-exits real `bun test` on POSIX, so the
   * Windows post-run linger can't be reproduced with a genuine run.
   */
  spawnArgv?: (file: string) => string[];
}

interface FileResult {
  file: string;
  ok: boolean;
  /** Killed at the hard deadline without ever writing a complete report — a genuine hang. */
  timedOut: boolean;
  /** Finished (report written) but had to be force-killed to exit. */
  forced: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// bun's JUnit report ends with this once the whole run (tests + hooks) is done —
// its presence means "finished", so only process *exit* may still be pending.
const JUNIT_CLOSE = '</testsuites>';

async function readJunit(path: string): Promise<{ complete: boolean; failures: number | null }> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return { complete: false, failures: null }; // not written yet (ENOENT)
  }
  const complete = text.includes(JUNIT_CLOSE);
  const match = text.match(/<testsuites\b[^>]*\bfailures="(\d+)"/);
  return { complete, failures: match ? Number(match[1]) : null };
}

/**
 * Runs each `src/**\/*.test.ts` file in its own `bun test` process, up to
 * `navigator.hardwareConcurrency` in parallel.
 *
 * Per-file isolation is required because `Mochi.serve()` enforces a single
 * instance per process (the `globalThis.__mochi_config__` singleton) — booting
 * two servers in one process throws "Mochi.serve() has already been called."
 * Separate processes also sidestep Bun bundler EISDIR errors and test-global
 * pollution from compiling the same Svelte entry twice.
 *
 * Exits the process with code 1 if any file fails.
 */
export async function runTests(options: RunTestsOptions = {}): Promise<void> {
  const dir = options.dir ?? '.';
  const sequential = new Set(options.sequential ?? []);
  const fileTimeoutMs = options.fileTimeoutMs ?? 120_000;
  const exitGraceMs = options.exitGraceMs ?? 8_000;
  const pollIntervalMs = options.pollIntervalMs ?? 150;
  const spawnArgv = options.spawnArgv ?? ((file: string) => ['bun', 'test', '--timeout', '30000', file]);

  const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan(dir))).sort();
  const parallel = all.filter((f) => !sequential.has(f));

  const concurrency = navigator.hardwareConcurrency;
  console.log(`Running ${all.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.size} sequential)`);

  const results: FileResult[] = [];

  // Run one file in its own `bun test` process. Completion is detected from the
  // child's JUnit report file (not its stdout — bun block-buffers pipe output, so
  // a hung process's summary never reaches us). Two wedge modes: a run that never
  // writes a report (hard `fileTimeoutMs` deadline → a real hang, failed), and a
  // run that finished but whose process won't exit (report present → force-killed
  // after `exitGraceMs`, judged by the report's failure count).
  async function runFile(file: string): Promise<FileResult> {
    const outfile = join(tmpdir(), `mochi-junit-${crypto.randomUUID()}.xml`);
    const proc = Bun.spawn([...spawnArgv(file), '--reporter=junit', `--reporter-outfile=${outfile}`], {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Drain both pipes so a chatty child never stalls on a full OS buffer, and so
    // the captured output is available for logging after the process ends.
    const stdoutP = new Response(proc.stdout).text();
    const stderrP = new Response(proc.stderr).text();

    let settled = false;
    const exited = proc.exited.then(() => 'exited' as const);
    const watched = (async () => {
      const deadline = Date.now() + fileTimeoutMs;
      while (!settled && Date.now() < deadline) {
        if ((await readJunit(outfile)).complete) {
          return 'complete' as const;
        }
        await Bun.sleep(pollIntervalMs);
      }
      return 'timeout' as const;
    })();

    const outcome = await Promise.race([exited, watched]);
    settled = true;

    let timedOut = false;
    let forced = false;
    if (outcome === 'timeout') {
      // Hard deadline with no report: the run never finished. A real hang.
      timedOut = true;
      proc.kill();
    } else if (outcome === 'complete') {
      // Report written but not exited — grant a short grace, then force-kill.
      const graced = await Promise.race([proc.exited.then(() => 'exited' as const), Bun.sleep(exitGraceMs).then(() => 'grace' as const)]);
      if (graced !== 'exited') {
        forced = true;
        proc.kill();
      }
    }

    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutP, stderrP]);

    let ok: boolean;
    if (timedOut) {
      ok = false;
    } else if (forced) {
      // Tests finished; the process just wouldn't close. Trust the report.
      const { failures } = await readJunit(outfile);
      ok = failures === 0;
    } else {
      ok = exitCode === 0;
    }

    await unlink(outfile).catch(() => {});
    return { file, ok, timedOut, forced, exitCode, stdout, stderr };
  }

  function report(result: FileResult, prefix = ''): void {
    if (result.timedOut) {
      console.log(`\n${prefix}✗ ${result.file} — TIMED OUT after ${Math.round(fileTimeoutMs / 1000)}s (killed, never finished)`);
    } else if (result.forced) {
      const mark = result.ok ? '✓' : '✗';
      console.log(`\n${prefix}${mark} ${result.file} — force-exited (tests finished; process did not close)`);
    } else {
      console.log(`\n${prefix}${result.ok ? '✓' : '✗'} ${result.file}`);
    }
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }

  let idx = 0;
  async function next(): Promise<void> {
    while (idx < parallel.length) {
      const file = parallel[idx++]!;
      const result = await runFile(file);
      results.push(result);
      report(result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => next()));

  for (const file of sequential) {
    const result = await runFile(file);
    results.push(result);
    report(result, '→ ');
  }

  const failed = results.filter((r) => !r.ok);
  const forced = results.filter((r) => r.forced);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} tests passed (concurrency: ${concurrency})`);
  if (forced.length > 0) {
    console.log(`${forced.length} file(s) finished but had to be force-exited (process would not close): ${forced.map((r) => r.file).join(', ')}`);
  }
  if (failed.length > 0) {
    console.log('Failed:');
    for (const r of failed) {
      console.log(`  ✗ ${r.file}${r.timedOut ? ' (timed out)' : r.forced ? ' (force-exited, had failures)' : ''}`);
    }
    process.exit(1);
  }
}
