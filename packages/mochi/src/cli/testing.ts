import { Glob } from 'bun';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RunTestsOptions {
  /** Package root to glob `src/**\/*.test.ts` from and run each file in. Defaults to the cwd. */
  dir?: string;
  /** Test files (paths relative to `dir`) that must run sequentially, after the parallel batch. */
  sequential?: Iterable<string>;
  /**
   * Like `sequential`, but applied on Windows only — the escape hatch for a file that misbehaves under parallel load
   * there while being fine everywhere else. Prefer leaving this empty and letting the wedge telemetry name a file first;
   * quarantining on suspicion is how the whole suite ended up serialized on Windows in the first place.
   */
  windowsSequential?: Iterable<string>;
  /**
   * Test files (paths relative to `dir`) to skip on Windows only. A file that wedges in Bun's native post-test shutdown
   * *after* a clean pass is already tolerated automatically (see `toleratedWindowsWedge`), so this list is reserved for
   * files that wedge *before* printing a clean pass, or that genuinely cannot run on Windows (e.g. POSIX-signal tests).
   * Skipped files are logged, and their logic still runs on Linux and macOS.
   */
  windowsSkip?: Iterable<string>;
  /**
   * Hard per-file deadline (ms). A `bun test` child still running past it is killed; if its junit report shows a
   * finished green run (a Windows shutdown wedge) the file still counts as passed, otherwise it is recorded as failed
   * with "TIMED OUT". Either way one wedged process can't hang the run — a backstop for Bun's per-*test* `--timeout`, which fails a
   * test while leaving the process alive. Default 60_000: far above any healthy file and well under CI's job cap.
   */
  fileTimeoutMs?: number;
}

interface FileResult {
  file: string;
  ok: boolean;
  /** The child had to be killed rather than exiting on its own — either the deadline or a post-run wedge. */
  killed: boolean;
  /** Killed because its junit report proved the run had finished while the process stayed alive, rather than on the deadline. */
  wedged: boolean;
  /** The file was killed but its junit report shows a finished green run — a Bun-on-Windows shutdown wedge, tolerated. */
  wedgedTolerated: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Failure count from the junit report, when one was read; `null` when the child exited normally or wrote nothing. */
  junitFailures: number | null;
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
const JUNIT_POLL_MS = 250;
/** How long a child gets to exit on its own once its report proves the run is over, before it counts as wedged. */
const WEDGE_GRACE_MS = 5_000;

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

  const raw = (result.stderr.trim() ? result.stderr : result.stdout).split('\n').filter((l) => l.trim() && !l.startsWith('bun test v'));
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

export interface JunitSummary {
  tests: number;
  failures: number;
}

/**
 * Pulls the run totals out of a `bun test --reporter=junit` report's root `<testsuites>` element, or null when the
 * input is missing, truncated, or not a report. Bun writes the report only at the end of a completed run, so a missing
 * or partial file is proof the process was killed mid-run rather than after finishing.
 */
export function parseJunitSummary(xml: string | null): JunitSummary | null {
  if (!xml) {
    return null;
  }
  let summary: JunitSummary | null = null;
  new HTMLRewriter()
    .on('testsuites', {
      element(el) {
        if (summary) {
          return;
        }
        // Number(null) and Number('') are both 0, which would let an attribute-less root pass as a green run.
        const testsAttr = el.getAttribute('tests');
        const failuresAttr = el.getAttribute('failures');
        if (!testsAttr?.trim() || !failuresAttr?.trim()) {
          return;
        }
        const tests = Number(testsAttr);
        const failures = Number(failuresAttr);
        if (Number.isInteger(tests) && Number.isInteger(failures)) {
          summary = { tests, failures };
        }
      },
    })
    .transform(xml);
  return summary;
}

/**
 * True once `junitPath` holds a *complete* report. The parse alone is not enough: the run totals live in the root
 * `<testsuites>` open tag, so `parseJunitSummary` reports them happily off a prefix that stops mid-document — and for a
 * report of any size that prefix is a real, observable state while the child is still writing. Requiring the closing tag
 * means "the run is over" never rests on the parser being strict about truncation. A read error (Windows file locking, a
 * virus scanner holding the handle) counts as "not ready yet".
 */
export async function junitReportIsComplete(junitPath: string): Promise<boolean> {
  try {
    const report = Bun.file(junitPath);
    if (!(await report.exists())) {
      return false;
    }
    const xml = await report.text();
    return xml.includes('</testsuites>') && parseJunitSummary(xml) !== null;
  } catch {
    return false;
  }
}

/**
 * A file that blew the per-file deadline is tolerated only on Windows and only if its junit report proves the run had
 * already finished green — Bun's native post-test shutdown wedges there with some in-process resources (e.g. PGlite's
 * WASM instance) still loaded, a runtime bug with no JS-level recovery. `platform` is a parameter so tests can exercise
 * both branches.
 */
export function toleratedWindowsWedge(timedOut: boolean, junitXml: string | null, platform: NodeJS.Platform = process.platform): boolean {
  if (!timedOut || platform !== 'win32') {
    return false;
  }
  const summary = parseJunitSummary(junitXml);
  return summary !== null && summary.failures === 0;
}

/** Names every file that had to be killed after its run had already finished — the signal for tuning Windows fan-out. */
function reportWedges(results: FileResult[]): void {
  const wedges = results.filter((r) => r.wedged);
  if (wedges.length === 0) {
    return;
  }
  const tolerated = wedges.filter((r) => r.wedgedTolerated).length;
  const detail = wedges.map((r) => `${r.file} (${(r.durationMs / 1000).toFixed(1)}s)`).join(', ');
  console.log(`Wedges: ${tolerated}/${wedges.length} tolerated, ${wedges.length - tolerated} fatal — ${detail}`);
}

const DEFAULT_LOCAL_CONCURRENCY = 6;

/**
 * Worker fan-out for the per-file test run. Local dev caps at 6 to keep the machine usable; CI sets
 * `MOCHI_MAX_CONCURRENCY=max` (or a number ≥ core count) for full hardware concurrency.
 *
 * Windows used to pin this to 1, on the untested theory that its post-test shutdown wedge came from many processes
 * tearing down at once. Measured on windows-latest over 27 same-commit samples at 1/2/4 workers (PR #305): the framework
 * suite passed 168/168 in every one, and the single wedge observed was at 4 workers on `queuePglite.test.ts` — a file
 * already known to wedge run alone. Wall-clock went ~140s → ~85s → ~65s, so the pin cost more than half the runtime and
 * bought nothing. `toleratedWindowsWedge` absorbs the wedge itself; concurrency never did.
 *
 * `cores`/`envValue` are parameters so tests can exercise every branch without touching globals.
 */
export function resolveConcurrency(cores: number = navigator.hardwareConcurrency, envValue: string | undefined = process.env.MOCHI_MAX_CONCURRENCY): number {
  const raw = envValue?.trim().toLowerCase();
  if (raw === 'max' || raw === 'auto') {
    return cores;
  }
  const parsed = raw ? Number(raw) : NaN;
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCAL_CONCURRENCY;
  return Math.max(1, Math.min(cap, cores));
}

/**
 * Runs each `src/**\/*.test.ts` file in its own `bun test` process, up to a capped worker count (6 locally, or
 * `MOCHI_MAX_CONCURRENCY` to override — CI sets `max` for full hardware concurrency), exiting with code 1 if any file
 * fails.
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
  const fileTimeoutMs = options.fileTimeoutMs ?? 60_000;
  const runStartedAt = performance.now();

  // Each child writes a junit report here; it doubles as the completion sentinel for the Windows wedge tolerance.
  const junitDir = mkdtempSync(join(tmpdir(), 'mochi-junit-'));

  const isWindows = process.platform === 'win32';
  const windowsSkip = new Set(isWindows ? (options.windowsSkip ?? []) : []);
  // `windowsSequential` carries the same contract as `sequential`, scoped to the platform that needs it. Merging before
  // the buckets are cut keeps `windowsSkip` winning over both.
  const serialRequests = new Set([...(options.sequential ?? []), ...(isWindows ? (options.windowsSequential ?? []) : [])]);

  // Bun's Glob yields backslash paths on Windows; normalize to forward slashes so
  // the `sequential`/`windowsSkip` sets (written with `/`) match. `bun test` accepts
  // forward-slash paths on Windows too, so the spawned command is unaffected.
  const all = (await Array.fromAsync(new Glob('src/**/*.test.ts').scan(dir))).map((f) => f.replaceAll('\\', '/')).sort();
  const included = all.filter((f) => !windowsSkip.has(f));
  // Both buckets are cut from `included`, so a skipped file can't be resurrected by also appearing in a serial list, and
  // the counts below describe what actually runs.
  const sequential = included.filter((f) => serialRequests.has(f));
  const parallel = included.filter((f) => !serialRequests.has(f));

  if (all.length > included.length) {
    console.log(`Skipping ${all.length - included.length} file(s) on Windows: ${[...windowsSkip].join(', ')}`);
  }

  // A renamed file left behind in a serial list used to silently spawn `bun test <missing>`.
  const unmatched = [...serialRequests].filter((f) => !all.includes(f));
  if (unmatched.length > 0) {
    console.log(`Warning: serial entries match no test file: ${unmatched.join(', ')}`);
  }

  const concurrency = resolveConcurrency();
  console.log(`Running ${included.length} test files (${parallel.length} parallel × ${concurrency} workers, ${sequential.length} sequential)`);

  const results: FileResult[] = [];

  // Bun's `--timeout` fails an individual test but leaves the process alive, so one wedged after its tests — a leaked
  // handle, or the Bun-on-Windows shutdown quirk — would block the worker on `proc.exited` until CI's job cap. The hard
  // deadline turns that into a fast outcome: a named failure, or (Windows-only, after a clean pass) a tolerated wedge.
  let junitSeq = 0;
  async function runFile(file: string): Promise<FileResult> {
    // The counter keeps paths unique: `/`→`_` alone is not injective (src/a/b.test.ts vs src/a_b.test.ts), and a
    // collision would let a wedged file adopt its collider's green report.
    const junitPath = join(junitDir, `${junitSeq++}-${file.replaceAll('/', '_')}.xml`);
    const startedAt = performance.now();
    // The running binary, never the PATH name: an npm-installed Bun puts a `bun.cmd` shim on Windows PATH, and killing
    // that shim leaves the real `bun test` alive holding the output pipes, so no deadline below can bound anything.
    const proc = Bun.spawn([process.execPath, 'test', '--timeout', '30000', '--reporter=junit', `--reporter-outfile=${junitPath}`, file], {
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

    const exited = proc.exited.then(() => 'exited' as const);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = <T extends string>(ms: number, value: T): Promise<T> =>
      new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(value), ms);
        timer.unref?.();
        timers.push(timer);
      });

    // `bun test` buffers the whole junit report and writes it last, after the final `afterAll`, so a complete report is
    // proof the run is over — strictly more than the deadline knows, because it separates "still working" from "done,
    // not dying". Sleeping before the first check keeps short files from being touched at all.
    let watching = true;
    const reportComplete = (async (): Promise<'report' | 'stopped'> => {
      while (watching) {
        await Bun.sleep(JUNIT_POLL_MS);
        if (!watching) {
          break;
        }
        if (await junitReportIsComplete(junitPath)) {
          return 'report';
        }
      }
      return 'stopped';
    })();

    const first = await Promise.race([exited, reportComplete, after(fileTimeoutMs, 'timeout' as const)]);

    // The run is provably finished but the child is still alive. Don't kill it yet: a green report is not the same claim
    // as exit 0 (a test can set `process.exitCode` off a passing run), and only the child's own exit carries the real
    // code. The measured report→exit gap is ~1ms, so the grace is free on anything healthy.
    const outcome = first === 'report' ? await Promise.race([exited, after(WEDGE_GRACE_MS, 'wedged' as const)]) : first;

    watching = false;
    for (const timer of timers) {
      clearTimeout(timer);
    }

    const killed = outcome === 'timeout' || outcome === 'wedged';
    if (killed) {
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
    // Authoritative parse, post-mortem, on a file nothing is writing any more: the poll above only decided when to stop
    // waiting, never what the verdict is, so a torn read up there can't reach the result down here.
    const junitFile = Bun.file(junitPath);
    const junitXml = killed && (await junitFile.exists()) ? await junitFile.text() : null;
    const wedgedTolerated = toleratedWindowsWedge(killed, junitXml);
    return {
      file,
      ok: (!killed && exitCode === 0) || wedgedTolerated,
      killed,
      wedged: outcome === 'wedged',
      wedgedTolerated,
      exitCode,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - startedAt),
      junitFailures: parseJunitSummary(junitXml)?.failures ?? null,
    };
  }

  function report(result: FileResult, prefix = ''): void {
    const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
    if (result.wedgedTolerated) {
      console.log(`\n${prefix}⚠ ${result.file} — passed, but Bun wedged in post-test shutdown on Windows (tolerated, killed after ${secs(result.durationMs)})`);
    } else if (result.wedged) {
      console.log(`\n${prefix}✗ ${result.file} — finished (junit: ${result.junitFailures ?? '?'} failures) but never exited — killed after ${secs(result.durationMs)}`);
    } else if (result.killed) {
      console.log(`\n${prefix}✗ ${result.file} — TIMED OUT after ${secs(fileTimeoutMs)} (killed)`);
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

  // A wedged survivor can still hold a report open on Windows, and an EPERM here would take down a run whose files all
  // passed.
  try {
    rmSync(junitDir, { recursive: true, force: true });
  } catch {
    // Ephemeral temp dir; the OS reclaims it.
  }

  const failed = results.filter((r) => !r.ok);
  const wallMs = Math.round(performance.now() - runStartedAt);
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `${results.length - failed.length}/${results.length} test files passed (concurrency: ${concurrency}, platform: ${process.platform}, wall ${(wallMs / 1000).toFixed(1)}s)`,
  );
  reportWedges(results);
  if (failed.length > 0) {
    printRunFailures(failed);
    process.exit(1);
  }
}

function printRunFailures(failed: FileResult[]): void {
  // Re-print each failure at the very end: with files streaming out of order across workers, the error text that
  // matters is buried thousands of lines up.
  console.log('Failed:');
  for (const r of failed) {
    console.log(`\n  ✗ ${r.file}${r.wedged ? ' (finished, never exited)' : r.killed ? ' (timed out)' : ''}`);
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
}
