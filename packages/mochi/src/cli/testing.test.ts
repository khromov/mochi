import { describe, expect, test } from 'bun:test';
import { extractFailures } from './testing';

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
