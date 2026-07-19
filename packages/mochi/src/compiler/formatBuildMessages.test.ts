// The isolated-linker hint must fire only on the known Bun bug's signature —
// a read failure on a file inside the symlinked node_modules/.bun store — and
// never on ordinary build errors, so real diagnostics stay uncluttered.
import { describe, expect, test } from 'bun:test';
import { formatBuildMessages } from './ComponentRegistry';

describe('formatBuildMessages isolated-linker hint', () => {
  test('appends the hint for a read failure inside the .bun store', () => {
    const out = formatBuildMessages([
      {
        message: 'EISDIR reading file: "/app/node_modules/.bun/@noble+ciphers@2.2.0/node_modules/@noble/ciphers/aes.js"',
        position: null,
      },
    ]);
    expect(out).toContain('linker = "hoisted"');
    expect(out).toContain('known Bun bug');
  });

  test('recognizes the "Unexpected reading file" wording and Windows separators', () => {
    const out = formatBuildMessages([
      {
        message: 'Unexpected reading file: "C:\\app\\node_modules\\.bun\\mitt@3.0.1\\node_modules\\mitt\\index.js"',
        position: null,
      },
    ]);
    expect(out).toContain('linker = "hoisted"');
  });

  test('stays silent for ordinary build errors', () => {
    const out = formatBuildMessages([
      {
        message: 'Could not resolve: "./missing.svelte"',
        position: { file: '/app/src/Page.svelte', line: 3, column: 10 },
      },
    ]);
    expect(out).not.toContain('linker = "hoisted"');
  });

  test('stays silent for read failures outside the .bun store', () => {
    const out = formatBuildMessages([{ message: 'EISDIR reading file: "/app/src/pages"', position: null }]);
    expect(out).not.toContain('linker = "hoisted"');
  });
});
