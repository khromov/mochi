import { test, expect } from 'bun:test';

// `bun test` exits 1 if a workspace has zero test files, and the root
// `bun --filter='*' run test` fans out to every workspace. Delete this file
// once packages/site has real tests of its own.
test('placeholder', () => {
  expect(true).toBe(true);
});
