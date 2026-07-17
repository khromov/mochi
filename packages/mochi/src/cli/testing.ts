import { Glob } from 'bun';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
  /**
   * Test files (paths relative to `dir`) to skip on Windows only. For suites that
   * pass every test but then wedge in Bun's native post-test shutdown on Windows —
   * a runtime bug with no JS-level recovery (bun stops running the loop before it
   * hangs) and no reproduction off-Windows to fix from. Skipped files are logged so
   * the gap is never silent; their logic still runs on Linux/macOS.
   */
  windowsSkip?: Iterable<string>;
  /**
   * Hard per-file deadline (ms). A `bun test` child that hasn't exited by then is
   * killed and the file is recorded as failed with a "TIMED OUT" message, so one
   * wedged process can't hang the whole run. Backstops Bun's per-*test* `--timeout`,
   * which fails a test but never forces the process to exit. Default 60_000 — well
   * above any healthy file (the slowest here is a few seconds) and well under CI's
   * job cap, so a genuinely wedged file fails fast and named.
   */
  fileTimeoutMs?: number;
}

interface FileResult {
  file: string;
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
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
  const fileTimeoutMs = options.fileTimeoutMs ?? 60_000;

  const windowsSkip = new Set(process.platform === 'win32' ? (options.windowsSkip ?? []) : []);

  // Bun's Glob yields backslash paths on Windows; normalize to forward slashes so
  // the `sequential`/`windowsSkip` sets (written with `/`) match. `bun test` accepts
  // forward-slash paths on Windows too, so the spawned command is unaffected.
  const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan(dir))).map((f) => f.replaceAll('\\', '/')).sort();
  const included = all.filter((f) => !windowsSkip.has(f));
  const parallel = included.filter((f) => !sequential.has(f));

  if (all.length > included.length) {
    console.log(`Skipping ${all.length - included.length} file(s) on Windows (Bun native-shutdown wedge): ${[...windowsSkip].join(', ')}`);
  }

  // Run one file at a time on Windows. Some suites pass every test but then wedge
  // in Bun's native post-test shutdown there (no JS-level recovery is possible —
  // bun stops running the loop before it hangs); this tests the theory that the
  // wedge is triggered by many processes tearing down under parallel load. Costs
  // wall-clock but keeps the run honest without skipping or faking a pass.
  const concurrency = process.platform === 'win32' ? 1 : navigator.hardwareConcurrency;
  console.log(`Running ${included.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.size} sequential)`);

  const results: FileResult[] = [];

  // Run one file in its own `bun test` process under a hard deadline. Bun's
  // `--timeout` only fails an individual test; a process wedged after its tests
  // (a leaked handle, or a Bun-on-Windows shutdown quirk that wedges after every
  // test passes) would otherwise block the worker on `proc.exited` forever and
  // hang the whole run until CI's job cap. Killing it turns that into a fast,
  // named failure.
  async function runFile(file: string): Promise<FileResult> {
    const proc = Bun.spawn(['bun', 'test', '--timeout', '30000', file], {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Drain from the start so a chatty-but-progressing file can't stall on a full
    // OS pipe buffer (~64 KB) and masquerade as a hang. `proc.kill()` closes the
    // child's write ends, so these resolve with the captured (partial) output.
    const stdoutP = new Response(proc.stdout).text();
    const stderrP = new Response(proc.stderr).text();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), fileTimeoutMs);
      timer.unref?.();
    });

    const outcome = await Promise.race([proc.exited, deadline]);
    clearTimeout(timer);

    let timedOut = false;
    if (outcome === 'timeout') {
      timedOut = true;
      proc.kill();
      // On POSIX that was SIGTERM, which a process wedged in native code — the
      // very case this deadline exists for — can ignore; awaiting proc.exited
      // would then hang the run anyway. Give it a moment to die cleanly, then
      // SIGKILL. (On Windows kill() already hard-terminates.)
      const died = await Promise.race([proc.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
      if (!died) {
        proc.kill('SIGKILL');
      }
    }

    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutP, stderrP]);
    return { file, ok: !timedOut && exitCode === 0, timedOut, exitCode, stdout, stderr };
  }

  function report(result: FileResult, prefix = ''): void {
    if (result.timedOut) {
      console.log(`\n${prefix}✗ ${result.file} — TIMED OUT after ${Math.round(fileTimeoutMs / 1000)}s (killed)`);
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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length - failed.length}/${results.length} tests passed (concurrency: ${concurrency})`);
  if (failed.length > 0) {
    console.log('Failed:');
    for (const r of failed) {
      console.log(`  ✗ ${r.file}${r.timedOut ? ' (timed out)' : ''}`);
    }
    process.exit(1);
  }
}
