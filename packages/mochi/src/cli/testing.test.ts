import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFailures, parseJunitSummary, toleratedWindowsWedge } from './testing';

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

  test('null for a report truncated mid-write', () => {
    expect(parseJunitSummary(PASS_XML.slice(0, PASS_XML.indexOf('failures=') + 11))).toBeNull();
  });

  test('null for console output that is not a report at all', () => {
    expect(parseJunitSummary('bun test v1.3.14\n\n 1 pass\n 0 fail\nRan 1 test across 1 file. [3.74s]')).toBeNull();
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

// Spawns real `bun test` children to pin the Bun behavior the wedge tolerance relies on: the junit report is written
// only at the end of a completed run, so it can never green-light a process that was killed or that recorded a failure.
describe('junit report as a completion sentinel', () => {
  async function junitAfterRun(source: string, { killAfterMs }: { killAfterMs?: number } = {}): Promise<string | null> {
    const dir = mkdtempSync(join(tmpdir(), 'mochi-junit-probe-'));
    try {
      writeFileSync(join(dir, 'probe.test.ts'), source);
      const reportPath = join(dir, 'report.xml');
      const proc = Bun.spawn(['bun', 'test', '--reporter=junit', `--reporter-outfile=${reportPath}`, 'probe.test.ts'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      });
      if (killAfterMs !== undefined) {
        await Bun.sleep(killAfterMs);
        proc.kill('SIGKILL');
      }
      await proc.exited;
      const report = Bun.file(reportPath);
      return (await report.exists()) ? await report.text() : null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

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
