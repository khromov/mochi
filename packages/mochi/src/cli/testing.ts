import { Glob } from 'bun';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
  /**
   * Test files (paths relative to `dir`) to skip on Windows only. A file that wedges in Bun's native post-test shutdown
   * *after* a clean pass is already tolerated automatically (see `toleratedWindowsWedge`), so this list is reserved for
   * files that wedge *before* printing a clean pass, or that genuinely cannot run on Windows (e.g. POSIX-signal tests).
   * Skipped files are logged, and their logic still runs on Linux and macOS.
   */
  windowsSkip?: Iterable<string>;
  /**
   * Hard per-file deadline (ms). A `bun test` child still running past it is killed; if it had already printed a clean
   * pass (a Windows shutdown wedge) the file still counts as passed, otherwise it is recorded as failed with "TIMED
   * OUT". Either way one wedged process can't hang the run — a backstop for Bun's per-*test* `--timeout`, which fails a
   * test while leaving the process alive. Default 60_000: far above any healthy file and well under CI's job cap.
   */
  fileTimeoutMs?: number;
}

interface FileResult {
  file: string;
  ok: boolean;
  timedOut: boolean;
  /** The file blew the deadline but had already printed a clean pass — a Bun-on-Windows shutdown wedge, tolerated. */
  wedgedTolerated: boolean;
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
 * Pulls failing test names and their error text out of a `bun test` run. Bun prints a failure's source snippet and
 * `error:` block *before* the `(fail) <name>` line naming it, so lines buffer and attach to the marker that follows.
 * Blocks with no following marker — an unhandled error between tests, an import that threw — stay unattached.
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

const CLEAN_FOOTER_RE = /^\s*Ran \d+ tests? across \d+ files?\./m;
const ZERO_FAIL_RE = /^\s*0 fail\b/m;
const FAIL_MARKER_RE = /^\(fail\)/m;

/**
 * True only when `bun test`'s output proves the file finished cleanly: the "Ran N tests" completion footer, a `0 fail`
 * line, no `(fail)` markers, and no unattached error block. Requiring the footer is the safety catch — a process killed
 * mid-run (a real hang, an import that never resolves) never emits it, and an `afterAll` that throws makes Bun report a
 * failure — so the only thing this forgives is a wedge that happens *after* a green run.
 */
export function bunReportedCleanPass(result: Pick<FileResult, 'stdout' | 'stderr'>): boolean {
  const text = result.stderr.trim() ? result.stderr : result.stdout;
  if (!CLEAN_FOOTER_RE.test(text) || !ZERO_FAIL_RE.test(text) || FAIL_MARKER_RE.test(text)) {
    return false;
  }
  return extractFailures(result).failures.length === 0;
}

/**
 * A file that blew the per-file deadline is tolerated only on Windows and only if it had already printed a clean pass —
 * Bun's native post-test shutdown wedges there with some in-process resources (e.g. PGlite's WASM instance) still loaded,
 * a runtime bug with no JS-level recovery. `platform` is a parameter so tests can exercise both branches.
 */
export function toleratedWindowsWedge(timedOut: boolean, result: Pick<FileResult, 'stdout' | 'stderr'>, platform: NodeJS.Platform = process.platform): boolean {
  return timedOut && platform === 'win32' && bunReportedCleanPass(result);
}

/**
 * Runs each `src/**\/*.test.ts` file in its own `bun test` process, up to `navigator.hardwareConcurrency` in parallel,
 * exiting with code 1 if any file fails.
 *
 * Per-file isolation is required because `Mochi.serve()` enforces one instance per process — the
 * `globalThis.__mochi_config__` singleton plus its `__mochi_image_runtime__`/captcha/image/email siblings, none of which
 * `server.stop()` clears — so booting two servers in one process throws "Mochi.serve() has already been called."
 * Separate processes also sidestep `GlobalRegistrator`/happy-dom pollution and test-global pollution from compiling the
 * same Svelte entry twice. This is orthogonal to the Bun EISDIR bundler bug, which the root `bunfig.toml`'s hoisted
 * linker fixes, so that fix leaves per-file isolation just as necessary.
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

  // Windows runs one file at a time, testing the theory that its post-test shutdown wedge is triggered by many
  // processes tearing down under parallel load. It costs wall-clock but keeps the run honest.
  const concurrency = process.platform === 'win32' ? 1 : navigator.hardwareConcurrency;
  console.log(`Running ${included.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.size} sequential)`);

  const results: FileResult[] = [];

  // Bun's `--timeout` fails an individual test but leaves the process alive, so one wedged after its tests — a leaked
  // handle, or the Bun-on-Windows shutdown quirk — would block the worker on `proc.exited` until CI's job cap. The hard
  // deadline turns that into a fast outcome: a named failure, or (Windows-only, after a clean pass) a tolerated wedge.
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
      // On POSIX that was SIGTERM, which a process wedged in native code — the very case this deadline exists for — can
      // ignore, so awaiting `proc.exited` would hang the run anyway; a moment to die cleanly, then SIGKILL. Windows
      // `kill()` already hard-terminates.
      const died = await Promise.race([proc.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
      if (!died) {
        proc.kill('SIGKILL');
      }
    }

    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutP, stderrP]);
    const wedgedTolerated = toleratedWindowsWedge(timedOut, { stdout, stderr });
    return { file, ok: (!timedOut && exitCode === 0) || wedgedTolerated, timedOut, wedgedTolerated, exitCode, stdout, stderr };
  }

  function report(result: FileResult, prefix = ''): void {
    if (result.wedgedTolerated) {
      console.log(`\n${prefix}⚠ ${result.file} — passed, but Bun wedged in post-test shutdown on Windows (tolerated after ${Math.round(fileTimeoutMs / 1000)}s)`);
    } else if (result.timedOut) {
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
