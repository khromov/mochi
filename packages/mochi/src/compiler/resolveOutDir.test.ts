import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { resolveOutDir } from './resolveOutDir';

const root = realpathSync(mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-resolve-outdir-')));
mkdirSync(path.join(root, 'real'));

let linked = false;
try {
  symlinkSync(path.join(root, 'real'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  linked = true;
} catch {
  // Unprivileged Windows without junction support: the symlink cases below are skipped.
}

// chmod cannot lock out root, and Windows ignores POSIX permission bits.
const canDenyAccess = linked && process.platform !== 'win32' && process.getuid?.() !== 0;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveOutDir', () => {
  test.if(linked)('canonicalises the deepest existing ancestor and appends the missing tail', () => {
    expect(resolveOutDir(path.join(root, 'link', 'not', 'yet'))).toBe(path.join(root, 'real', 'not', 'yet'));
  });

  test('resolves a relative path against the cwd', () => {
    expect(resolveOutDir(path.relative(process.cwd(), path.join(root, 'real')))).toBe(path.join(root, 'real'));
  });

  test.if(canDenyAccess)('throws instead of returning an uncanonicalised path past an unreadable ancestor', () => {
    const locked = path.join(root, 'locked');
    mkdirSync(locked);
    symlinkSync(path.join(root, 'real'), path.join(locked, 'link'), 'dir');
    chmodSync(locked, 0o000);
    try {
      expect(() => resolveOutDir(path.join(locked, 'link', 'out'))).toThrow(/EACCES/);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
