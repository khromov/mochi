import { Glob } from 'bun';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
  /**
   * Hard per-file deadline (ms) for a child that never even finishes its tests
   * (a wedged test, a native call that never returns). Backstops Bun's per-*test*
   * `--timeout`, which fails a test but never forces the process to exit. A child
   * that DID finish its tests but won't exit is handled by `exitGraceMs` instead,
   * long before this fires. Default 300_000.
   */
  fileTimeoutMs?: number;
  /**
   * Grace (ms) granted after a child prints Bun's run summary but hasn't exited.
   * A cache/sweeper handle left open in teardown keeps a `bun test` process alive
   * on Windows even though every test passed; once the summary is out the run is
   * done, so we wait this long for a clean exit, then force-kill and take pass/fail
   * from the summary. Default 8_000.
   */
  exitGraceMs?: number;
  /**
   * Advanced / test-only: build the child argv for a file. Defaults to
   * `bun test --timeout 30000 <file>`. Exposed so the supervisor's linger/grace
   * logic can be driven against a controllable fake child (Bun force-exits real
   * `bun test` on POSIX, so the Windows post-summary linger can't be reproduced
   * with a genuine run).
   */
  spawnArgv?: (file: string) => string[];
}

interface FileResult {
  file: string;
  ok: boolean;
  /** Killed by the hard deadline without ever printing a summary — a genuine hang. */
  timedOut: boolean;
  /** Finished its tests (summary printed) but had to be force-killed to exit. */
  lingered: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// Bun prints this once, last, when a file's run is fully done (pass or fail).
// Its presence means "tests finished"; only process *exit* may still be pending.
const RUN_SUMMARY = /Ran \d+ tests? across \d+ files?/;
// A nonzero `bun test` summary fail count, or any per-test failure marker.
const HAS_FAILURE = /^\s*(?:[1-9]\d*) fail\b/m;

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
  const fileTimeoutMs = options.fileTimeoutMs ?? 300_000;
  const exitGraceMs = options.exitGraceMs ?? 8_000;
  const spawnArgv = options.spawnArgv ?? ((file: string) => ['bun', 'test', '--timeout', '30000', file]);

  const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan(dir))).sort();
  const parallel = all.filter((f) => !sequential.has(f));

  const concurrency = navigator.hardwareConcurrency;
  console.log(`Running ${all.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.size} sequential)`);

  const results: FileResult[] = [];

  // Run one file in its own `bun test` process. Two distinct wedge modes are
  // handled separately: a run that never finishes its tests (hard `fileTimeoutMs`
  // deadline → a real hang, failed), versus a run that finished but whose process
  // won't exit because teardown left a handle open (detected by the summary, then
  // force-killed after `exitGraceMs` and judged by the summary). Without the
  // latter, one lingering child would block its worker until the hard deadline —
  // and on Windows several cache tests linger this way despite passing.
  async function runFile(file: string): Promise<FileResult> {
    const proc = Bun.spawn(spawnArgv(file), {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Stream both pipes from the start: draining prevents a chatty child from
    // stalling on a full ~64 KB OS buffer, and it lets us spot the run summary
    // the moment it lands rather than only at EOF.
    let stdout = '';
    let stderr = '';
    let onSummary: () => void = () => {};
    const summarySeen = new Promise<void>((resolve) => {
      onSummary = resolve;
    });
    const pump = (stream: ReadableStream<Uint8Array>, append: (s: string) => void): Promise<void> =>
      (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          append(decoder.decode(chunk, { stream: true }));
          if (RUN_SUMMARY.test(stdout) || RUN_SUMMARY.test(stderr)) {
            onSummary();
          }
        }
        append(decoder.decode());
      })();
    const stdoutP = pump(proc.stdout, (s) => (stdout += s));
    const stderrP = pump(proc.stderr, (s) => (stderr += s));

    const delay = (ms: number): { promise: Promise<'timer'>; cancel: () => void } => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const promise = new Promise<'timer'>((resolve) => {
        timer = setTimeout(() => resolve('timer'), ms);
        timer.unref?.();
      });
      return { promise, cancel: () => clearTimeout(timer) };
    };

    const hard = delay(fileTimeoutMs);
    const exited = proc.exited.then(() => 'exited' as const);
    const summary = summarySeen.then(() => 'summary' as const);

    let timedOut = false;
    let lingered = false;

    const first = await Promise.race([exited, summary, hard.promise]);
    if (first === 'exited') {
      // Clean exit — the common case.
    } else if (first === 'timer') {
      // Hard deadline hit with no summary: the run never finished. A real hang.
      timedOut = true;
      proc.kill();
    } else {
      // Summary printed but not exited yet — grant a short grace, then force-kill.
      const grace = delay(exitGraceMs);
      const second = await Promise.race([exited, grace.promise, hard.promise]);
      grace.cancel();
      if (second !== 'exited') {
        lingered = true;
        proc.kill();
      }
    }
    hard.cancel();

    const [exitCode] = await Promise.all([proc.exited, stdoutP, stderrP]);

    let ok: boolean;
    if (timedOut) {
      ok = false; // genuine hang
    } else if (lingered) {
      // Tests finished; the process just wouldn't close. Trust the summary.
      ok = !HAS_FAILURE.test(stdout) && !HAS_FAILURE.test(stderr);
    } else {
      ok = exitCode === 0;
    }
    return { file, ok, timedOut, lingered, exitCode, stdout, stderr };
  }

  function report(result: FileResult, prefix = ''): void {
    if (result.timedOut) {
      console.log(`\n${prefix}✗ ${result.file} — TIMED OUT after ${Math.round(fileTimeoutMs / 1000)}s (killed, never finished)`);
    } else if (result.lingered) {
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
  const lingered = results.filter((r) => r.lingered);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} tests passed (concurrency: ${concurrency})`);
  if (lingered.length > 0) {
    console.log(`${lingered.length} file(s) finished but had to be force-exited (open handle in teardown): ${lingered.map((r) => r.file).join(', ')}`);
  }
  if (failed.length > 0) {
    console.log('Failed:');
    for (const r of failed) {
      console.log(`  ✗ ${r.file}${r.timedOut ? ' (timed out)' : r.lingered ? ' (force-exited, had failures)' : ''}`);
    }
    process.exit(1);
  }
}
