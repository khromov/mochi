import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFailures, junitReportIsComplete, parseJunitSummary, resolveConcurrency, toleratedWindowsWedge } from './testing';

// Verbatim `bun test` reporter output (v1.3): the source snippet and `error:` block
// are printed *before* the `(fail)` line they belong to.
const ASSERTION_OUTPUT = `
fmt.test.ts:
 9 |     console.log('some user stdout log');
10 |     expect(400).toBe(200);
                     ^
error: expect(received).toBe(expected)

Expected: 200
Received: 400

      at <anonymous> (/tmp/fmt.test.ts:10:17)
(fail) outer group > fails an assertion [3.70ms]
13 |   test('throws', () => {
14 |     throw new Error('boom from thrown test');
                                                ^
error: boom from thrown test
      at <anonymous> (/tmp/fmt.test.ts:14:44)
(fail) outer group > throws [0.21ms]

 1 pass
 2 fail
 2 expect() calls
Ran 3 tests across 1 file. [96.00ms]
`;

const IMPORT_ERROR_OUTPUT = `
bad.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './does-not-exist' from '/tmp/bad.test.ts'
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [6.00ms]
`;

describe('extractFailures', () => {
  test('names each failing test and keeps its error block', () => {
    const { failures, fallback } = extractFailures({ stderr: ASSERTION_OUTPUT, stdout: '' });

    expect(fallback).toBeUndefined();
    expect(failures.map((f) => f.name)).toEqual(['outer group > fails an assertion', 'outer group > throws']);
    expect(failures[0]!.detail).toEqual(['error: expect(received).toBe(expected)', '', 'Expected: 200', 'Received: 400', '', '      at <anonymous> (/tmp/fmt.test.ts:10:17)']);
    expect(failures[1]!.detail).toEqual(['error: boom from thrown test', '      at <anonymous> (/tmp/fmt.test.ts:14:44)']);
  });

  test('keeps an unhandled error that has no (fail) line', () => {
    const { failures } = extractFailures({ stderr: IMPORT_ERROR_OUTPUT, stdout: '' });

    expect(failures).toHaveLength(1);
    expect(failures[0]!.name).toBeNull();
    expect(failures[0]!.detail).toEqual(['# Unhandled error between tests', "error: Cannot find module './does-not-exist' from '/tmp/bad.test.ts'"]);
  });

  test('falls back to the tail of the output when nothing parses (killed process)', () => {
    const stderr = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');

    const { failures, fallback } = extractFailures({ stderr, stdout: '' });

    expect(failures).toEqual([]);
    expect(fallback).toHaveLength(20);
    expect(fallback!.at(-1)).toBe('line 29');
  });

  test('falls back to stdout when stderr is empty', () => {
    const { fallback } = extractFailures({ stderr: '   \n', stdout: 'error while spawning\n' });

    expect(fallback).toEqual(['error while spawning']);
  });

  test('truncates an oversized error block', () => {
    const stderr = ['error: huge', ...Array.from({ length: 40 }, (_, i) => `  at frame ${i}`), '(fail) big one [1ms]'].join('\n');

    const { failures } = extractFailures({ stderr, stdout: '' });

    expect(failures[0]!.name).toBe('big one');
    expect(failures[0]!.detail).toHaveLength(26);
    expect(failures[0]!.detail.at(-1)).toBe('… (truncated, 16 more lines)');
  });
});

// Verbatim `bun test --reporter=junit` reports (v1.3), written only at the end of a completed run.
const PASS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="1" assertions="6" failures="0" skipped="0" time="3.741">
  <testsuite name="queuePglite.test.ts" file="queuePglite.test.ts" tests="1" assertions="6" failures="0" skipped="0" time="3.6" hostname="ci">
    <testcase name="Mochi queue on pglite storage &gt; installs its schema and roundtrips a job in-process" classname="" time="3.596" file="queuePglite.test.ts" line="12" assertions="6" />
  </testsuite>
</testsuites>
`;

const FAIL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="1" assertions="1" failures="1" skipped="0" time="0.020">
  <testsuite name="fail.test.ts" file="fail.test.ts" tests="1" assertions="1" failures="1" skipped="0" time="0" hostname="ci">
    <testcase name="adds" classname="" time="0.000519" file="fail.test.ts" line="2" assertions="1">
      <failure type="AssertionError" />
    </testcase>
  </testsuite>
</testsuites>
`;

describe('parseJunitSummary', () => {
  test('reads the run totals from a passing report', () => {
    expect(parseJunitSummary(PASS_XML)).toEqual({ tests: 1, failures: 0 });
  });

  test('reads the failure count from a failing report', () => {
    expect(parseJunitSummary(FAIL_XML)).toEqual({ tests: 1, failures: 1 });
  });

  test('counts a per-test timeout as a failure', () => {
    expect(parseJunitSummary(FAIL_XML.replace('AssertionError', 'TimeoutError'))).toEqual({ tests: 1, failures: 1 });
  });

  test('null for a missing or empty report', () => {
    expect(parseJunitSummary(null)).toBeNull();
    expect(parseJunitSummary('')).toBeNull();
  });

  test('null for a root element that records no totals', () => {
    expect(parseJunitSummary('<testsuites></testsuites>')).toBeNull();
    expect(parseJunitSummary('<testsuites tests="" failures=""></testsuites>')).toBeNull();
    expect(parseJunitSummary('<testsuites tests="1"></testsuites>')).toBeNull();
  });

  test('null for a report truncated mid-write', () => {
    expect(parseJunitSummary(PASS_XML.slice(0, PASS_XML.indexOf('failures=') + 11))).toBeNull();
  });

  test('null for console output that is not a report at all', () => {
    expect(parseJunitSummary('bun test v1.3.14\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [3.74s]')).toBeNull();
  });

  // The totals live in the root open tag, so the parser reads them off a prefix that stops anywhere after it. This is
  // why completion is decided by junitReportIsComplete, not by a successful parse.
  test('a prefix truncated at a tag boundary still parses — the parser is not a completion check', () => {
    expect(parseJunitSummary(PASS_XML.slice(0, PASS_XML.indexOf('>', PASS_XML.indexOf('<testsuites')) + 1))).toEqual({ tests: 1, failures: 0 });
  });
});

describe('junitReportIsComplete', () => {
  const withReport = async (contents: string | null, run: (path: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-junit-complete-'));
    try {
      const path = join(dir, 'report.xml');
      if (contents !== null) {
        writeFileSync(path, contents);
      }
      await run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('true only once the closing tag has landed', async () => {
    await withReport(PASS_XML, async (path) => expect(await junitReportIsComplete(path)).toBe(true));
  });

  test('false for a prefix the parser would happily accept', async () => {
    const prefix = PASS_XML.slice(0, PASS_XML.indexOf('>', PASS_XML.indexOf('<testsuites')) + 1);
    expect(parseJunitSummary(prefix)).not.toBeNull();
    await withReport(prefix, async (path) => expect(await junitReportIsComplete(path)).toBe(false));
  });

  test('false for a missing file, and for a complete document with no totals', async () => {
    await withReport(null, async (path) => expect(await junitReportIsComplete(path)).toBe(false));
    await withReport('<testsuites></testsuites>', async (path) => expect(await junitReportIsComplete(path)).toBe(false));
  });
});

describe('toleratedWindowsWedge', () => {
  test('true only for a timed-out green report on win32', () => {
    expect(toleratedWindowsWedge(true, PASS_XML, 'win32')).toBe(true);
  });

  test('false on non-Windows even after a green report', () => {
    expect(toleratedWindowsWedge(true, PASS_XML, 'linux')).toBe(false);
  });

  test('false when the file did not time out', () => {
    expect(toleratedWindowsWedge(false, PASS_XML, 'win32')).toBe(false);
  });

  test('false for a win32 timeout whose report records a failure', () => {
    expect(toleratedWindowsWedge(true, FAIL_XML, 'win32')).toBe(false);
  });

  test('false for a win32 timeout that never wrote a report', () => {
    expect(toleratedWindowsWedge(true, null, 'win32')).toBe(false);
  });
});

describe('resolveConcurrency', () => {
  // Pass the env value explicitly (never `undefined`, which would trigger the parameter default and read the ambient
  // MOCHI_MAX_CONCURRENCY — `max` under CI). `''` is the honest "no override" input.
  test('with no override, defaults to 6 and clamps to core count', () => {
    expect(resolveConcurrency(12, '')).toBe(6);
    expect(resolveConcurrency(4, '')).toBe(4);
  });

  test('max/auto use the full core count', () => {
    expect(resolveConcurrency(12, 'max')).toBe(12);
    expect(resolveConcurrency(12, 'AUTO')).toBe(12);
  });

  test('a numeric override is honored and clamped to cores', () => {
    expect(resolveConcurrency(12, '3')).toBe(3);
    expect(resolveConcurrency(12, '100')).toBe(12);
  });

  test('invalid or non-positive values fall back to 6', () => {
    expect(resolveConcurrency(12, '0')).toBe(6);
    expect(resolveConcurrency(12, 'abc')).toBe(6);
  });

  test('reads MOCHI_MAX_CONCURRENCY from the environment when no value is passed', () => {
    const prev = process.env.MOCHI_MAX_CONCURRENCY;
    process.env.MOCHI_MAX_CONCURRENCY = 'max';
    try {
      expect(resolveConcurrency(9)).toBe(9);
    } finally {
      if (prev === undefined) {
        delete process.env.MOCHI_MAX_CONCURRENCY;
      } else {
        process.env.MOCHI_MAX_CONCURRENCY = prev;
      }
    }
  });
});

/** Runs `source` as a test file in a real `bun test` child, returning its captured output and junit report (if written). */
async function runProbeFile(source: string, { killAfterMs }: { killAfterMs?: number } = {}): Promise<{ stdout: string; stderr: string; junitXml: string | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-junit-probe-'));
  try {
    writeFileSync(join(dir, 'probe.test.ts'), source);
    const reportPath = join(dir, 'report.xml');
    const proc = Bun.spawn([process.execPath, 'test', '--reporter=junit', `--reporter-outfile=${reportPath}`, 'probe.test.ts'], {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdoutP = new Response(proc.stdout).text();
    const stderrP = new Response(proc.stderr).text();
    if (killAfterMs !== undefined) {
      await Bun.sleep(killAfterMs);
      proc.kill('SIGKILL');
    }
    const [stdout, stderr] = await Promise.all([stdoutP, stderrP, proc.exited]);
    const report = Bun.file(reportPath);
    return { stdout, stderr, junitXml: (await report.exists()) ? await report.text() : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Spawns real `bun test` children to pin the Bun behavior the wedge tolerance relies on: the junit report is written
// only at the end of a completed run, so it can never green-light a process that was killed or that recorded a failure.
describe('junit report as a completion sentinel', () => {
  const junitAfterRun = async (source: string, opts?: { killAfterMs?: number }): Promise<string | null> => (await runProbeFile(source, opts)).junitXml;

  test('a green run writes a report the wedge tolerance accepts', async () => {
    const xml = await junitAfterRun(`import { test, expect } from 'bun:test';\ntest('adds', () => { expect(1 + 1).toBe(2); });\n`);

    expect(parseJunitSummary(xml)).toEqual({ tests: 1, failures: 0 });
    expect(toleratedWindowsWedge(true, xml, 'win32')).toBe(true);
  });

  test('a failing run writes a report that records the failure', async () => {
    const xml = await junitAfterRun(`import { test, expect } from 'bun:test';\ntest('adds', () => { expect(1 + 1).toBe(3); });\n`);

    expect(parseJunitSummary(xml)?.failures).toBe(1);
    expect(toleratedWindowsWedge(true, xml, 'win32')).toBe(false);
  });

  test('a run killed before finishing writes no report at all', async () => {
    const xml = await junitAfterRun(`import { test } from 'bun:test';\ntest('hangs', async () => { await new Promise(() => {}); });\n`, { killAfterMs: 500 });

    expect(xml).toBeNull();
    expect(toleratedWindowsWedge(true, xml, 'win32')).toBe(false);
  });

  test('a module that throws at import time never yields a tolerable report', async () => {
    const xml = await junitAfterRun(`throw new Error('boom at import time');\n`);

    expect(toleratedWindowsWedge(true, xml, 'win32')).toBe(false);
  });
});

// Guards the verbatim fixtures at the top of this file against reporter drift: a Bun upgrade that reshapes the console
// output should fail here, not silently degrade the end-of-run failure excerpts to the raw-tail fallback.
describe('extractFailures against live bun output', () => {
  test('parses failure names and error text from a real failing run', async () => {
    const { stderr } = await runProbeFile(`import { describe, expect, test } from 'bun:test';
describe('outer group', () => {
  test('passes', () => { expect(1).toBe(1); });
  test('fails an assertion', () => { expect(400).toBe(200); });
  test('throws', () => { throw new Error('boom from thrown test'); });
});
`);

    const { failures, fallback } = extractFailures({ stdout: '', stderr });

    expect(fallback).toBeUndefined();
    expect(failures.map((f) => f.name)).toEqual(['outer group > fails an assertion', 'outer group > throws']);
    expect(failures[0]!.detail.join('\n')).toContain('Expected: 200');
    expect(failures[1]!.detail.join('\n')).toContain('boom from thrown test');
  });

  test('parses a real import error as an unattached failure', async () => {
    const { stderr } = await runProbeFile(`import './does-not-exist';\n`);

    const { failures } = extractFailures({ stdout: '', stderr });

    expect(failures).toHaveLength(1);
    expect(failures[0]!.name).toBeNull();
    expect(failures[0]!.detail.join('\n')).toContain("Cannot find module './does-not-exist'");
  });
});
