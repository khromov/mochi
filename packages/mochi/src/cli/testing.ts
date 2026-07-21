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

/** One failing test (or one unattached error block, `name: null`) plus the error text `bun test` printed for it. */
interface Failure {
  name: string | null;
  detail: string[];
}

export interface FailureExcerpt {
  failures: Failure[];
  /** Last lines of raw output, used when nothing parsed (a killed process, a crash before the reporter ran). */
  fallback?: string[];
}

const MARKER_RE = /^\((?:pass|fail|skip|todo)\)/;
const FAIL_RE = /^\(fail\)\s*(.*?)(?:\s*\[[\d.]+\s*m?s\])?$/;
const FOOTER_RE = /^\s*(?:\d+ (?:pass|fail|error|expect)|Ran \d+ tests?)/;
const ERROR_RE = /^\s*(?:error:|# Unhandled error)/;
const MAX_DETAIL_LINES = 25;
const MAX_FILE_LINES = 60;

/**
 * Pulls the failing test names and their error text out of a `bun test` run.
 *
 * `bun test` prints a failure's source snippet and `error:` block *before* the
 * `(fail) <name>` line that names it, so lines are buffered and attached to the
 * marker that follows them. Blocks with no following marker (an unhandled error
 * between tests, an import that threw) are kept unattached.
 */
export function extractFailures(result: Pick<FileResult, 'stdout' | 'stderr'>): FailureExcerpt {
  // The reporter writes to stderr; stdout only carries the version banner and the
  // test's own console output, so it is a fallback source only.
  const lines = result.stderr.split('\n');
  const failures: Failure[] = [];
  let pending: string[] = [];

  const flushUnattached = (): void => {
    if (pending.some((l) => ERROR_RE.test(l))) {
      failures.push({ name: null, detail: trimDetail(pending) });
    }
    pending = [];
  };

  for (const line of lines) {
    if (MARKER_RE.test(line)) {
      const failed = FAIL_RE.exec(line);
      if (failed) {
        failures.push({ name: failed[1]!.trim() || '(unnamed test)', detail: trimDetail(pending) });
      }
      pending = [];
    } else if (FOOTER_RE.test(line)) {
      flushUnattached();
    } else {
      pending.push(line);
    }
  }
  flushUnattached();

  if (failures.length > 0) {
    return { failures };
  }

  const raw = (result.stderr.trim() ? result.stderr : result.stdout).split('\n').filter((l) => l.trim() && !/^bun test v/.test(l));
  return { failures: [], fallback: raw.slice(-20) };
}

/** Reduce a buffered block to its error text: from the first `error:`/unhandled-error line onward, capped. */
function trimDetail(block: string[]): string[] {
  const start = block.findIndex((l) => ERROR_RE.test(l));
  const kept = (start === -1 ? block : block.slice(start)).filter((l) => !/^-{3,}$/.test(l.trim()));
  const trimmed = dropEdgeBlanks(kept);
  if (trimmed.length <= MAX_DETAIL_LINES) {
    return trimmed;
  }
  return [...trimmed.slice(0, MAX_DETAIL_LINES), `… (truncated, ${trimmed.length - MAX_DETAIL_LINES} more lines)`];
}

function dropEdgeBlanks(block: string[]): string[] {
  let start = 0;
  let end = block.length;
  while (start < end && !block[start]!.trim()) {
    start++;
  }
  while (end > start && !block[end - 1]!.trim()) {
    end--;
  }
  return block.slice(start, end);
}

/**
 * Runs each `src/**\/*.test.ts` file in its own `bun test` process, up to
 * `navigator.hardwareConcurrency` in parallel.
 *
 * Per-file isolation is required because `Mochi.serve()` enforces a single
 * instance per process (the `globalThis.__mochi_config__` singleton, plus its
 * siblings `__mochi_image_runtime__`/captcha/image/email config, none of which
 * `server.stop()` clears) — booting two servers in one process throws
 * "Mochi.serve() has already been called." Separate processes also sidestep
 * `GlobalRegistrator`/happy-dom pollution and test-global pollution from
 * compiling the same Svelte entry twice.
 *
 * Orthogonal to the Bun EISDIR bundler bug — that one is fixed separately by the
 * hoisted linker in the root `bunfig.toml`, not by this runner, so the linker
 * fix does not make per-file isolation optional.
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
    console.log(`Skipping ${all.length - included.length} file(s) on Windows: ${[...windowsSkip].join(', ')}`);
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
  console.log(`${results.length - failed.length}/${results.length} test files passed (concurrency: ${concurrency})`);
  if (failed.length > 0) {
    // Re-print each failure at the very end: with files streaming out of order
    // across workers, the error text that matters is buried thousands of lines up.
    console.log('Failed:');
    for (const r of failed) {
      console.log(`\n  ✗ ${r.file}${r.timedOut ? ' (timed out)' : ''}`);
      const { failures, fallback } = extractFailures(r);
      const body = failures.flatMap((f) => (f.name ? [`(fail) ${f.name}`, ...f.detail] : f.detail)).concat(fallback ?? []);
      if (body.length === 0) {
        console.log('    (no output captured before the process was killed)');
      }
      for (const line of body.slice(0, MAX_FILE_LINES)) {
        console.log(line.trim() ? `    ${line}` : '');
      }
      if (body.length > MAX_FILE_LINES) {
        console.log(`    … (truncated, ${body.length - MAX_FILE_LINES} more lines — see this file's output above)`);
      }
    }
    process.exit(1);
  }
}
