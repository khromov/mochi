---
name: test-validator
description: Mutation-test unit tests to verify they catch real failures. For each test, temporarily breaks the source code it exercises, confirms the test fails, then reverts. Flags mock-only tests and suggests fixes. Use when the user says "validate tests", "test-validator", or wants to check test quality.
user-invocable: true
---

# Test Validator

Validate that unit tests actually catch real failures by performing targeted mutation testing. For each test, identify the source code it exercises, temporarily break that code, verify the test fails, and revert. Flag tests that only exercise mocks.

## Invocation

- `/test-validator` — validate all test files in the project
- `/test-validator path/to/foo.test.ts` — validate specific file(s)
- `/test-validator path/to/foo.test.ts path/to/bar.test.ts` — validate multiple files

## Running tests in this project

This is a Bun monorepo. Use `bun test` to run tests:

```sh
# Run a single test file
bun test packages/mochi/src/islands/serverIslandCrypto.test.ts

# Run a single test by name within a file
bun test packages/mochi/src/islands/serverIslandCrypto.test.ts -t "round-trips"

# Run all tests
bun run test
```

Always use `bun test <file> -t "<test name>"` to isolate individual tests during mutation runs.

## Rules

- **Never leave mutations in place.** Revert the source file with `git checkout -- <file>` immediately after each mutation run — before moving to the next test.
- **Run one mutation at a time.** Never mutate multiple source files simultaneously.
- **Don't modify test files.** Only mutate source files.
- **Time-box.** Cap at 20 tests per invocation. If more exist, validate the first 20 and report how many were skipped.
- **Use the project's test runner.** Check CLAUDE.md or `package.json` for the correct test command. Use `-t <pattern>` to isolate individual tests.

## Steps

### 1. Discover test files

If args name specific files, use those. Otherwise find all `*.test.ts` / `*.test.js` files in the project (excluding `node_modules`, `.mochi`, `dist`).

### 2. Establish baseline

Run each test file once to confirm all tests pass. If any test already fails, flag it as **ALREADY FAILING** and skip it for mutation — don't waste time mutating code for a test that's already broken.

### 3. Analyze each test

For every `test()` / `it()` block in the file:

1. **Read the test body.** Understand what it imports, what it calls, and what it asserts.
2. **Trace the source.** Follow imports to find the source function or module the test exercises. Read that source code.
3. **Classify the test:**
   - **Real code** — the test calls actual source functions and asserts on their output.
   - **Mock-only** — the test mocks or stubs the source module entirely, and assertions only check mock call counts, mock return values, or inline expected output that never touches real logic.

**Mock-only heuristics** — flag a test as MOCK-ONLY if:

- All imports from the source module are replaced with mocks (`jest.mock`, `vi.mock`, `mock.module`, spies returning hardcoded values)
- Assertions only verify `.toHaveBeenCalled()`, `.toHaveBeenCalledWith()`, or mock return values
- The expected output is constructed inline in the test without involving any real source function
- The test never imports or invokes the real function under test

### 4. Mutate and validate

For each test classified as **real code**:

1. **Pick a mutation.** Identify the single most impactful line in the **source file** (not the test) that makes this test pass. Prefer mutations that are:
   - **Return values** — change a return value to something wrong (e.g., `return result` → `return null`, `return true` → `return false`)
   - **Conditional guards** — invert a condition (`if (x)` → `if (!x)`) or remove a guard entirely
   - **Key assignments** — remove or alter an assignment that computes the value under test
   - **Function call arguments** — swap an argument to something incorrect

2. **Apply the mutation.** Edit the source file — make exactly one targeted change.

3. **Run the single test.**

   ```sh
   <test-runner> <test-file> -t "<test name>"
   ```

   The test should **fail**. That means it caught the mutation.

4. **Immediately revert.**

   ```sh
   git checkout -- <source-file>
   ```

   Do this before anything else — even before recording the result.

5. **Record the result:**
   - **CAUGHT** — the test failed as expected. The test is sound.
   - **MISSED** — the test still passed despite the mutation. The test is not validating this code path. Note what the test should assert instead.

### 5. Report

Produce a report for each test file:

```
## Test Validator Report: <filename>

Baseline: X tests, all passing

| # | Test | Mutation | Result | Notes |
|---|------|----------|--------|-------|
| 1 | test name | return result → return null in source.ts:42 | CAUGHT | — |
| 2 | test name | removed guard in source.ts:18 | MISSED | add assertion for the falsy branch |
| 3 | test name | (mock-only) | MOCK-ONLY | calls mock, never invokes real fn; import and call the real function |

Summary: X/Y tests validated, Z mock-only, W missed mutations
```

After the table, for each **MISSED** or **MOCK-ONLY** test, write a concrete suggestion:

- What specific assertion to add, or what mock to replace with a real call
- A brief code sketch if it helps illustrate the fix

### 6. Verify clean state

After all mutations are done, run `git status` and `git diff` to confirm no mutations leaked. If any source file is still modified, revert it and warn the user.

## Guardrails

- **Safety first.** If `git checkout` fails for any reason, stop immediately and alert the user. Do not proceed with further mutations while a source file is in a mutated state.
- **Don't fix tests yourself.** Only suggest fixes — the user decides whether to apply them.
- **Don't run the full test suite per mutation.** Only run the single test being validated. Full-suite runs are too slow for per-test mutation.
- **Respect the project's test infrastructure.** If setup/teardown or shared fixtures exist, account for them when isolating tests.
