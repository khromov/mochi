// The build used to `rmSync` its out-dir unconditionally, so `--out-dir .` erased the project and a `.mochi` symlink
// erased whatever directory it pointed at.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from './build';
import { Mochi } from '../Mochi';

const PKG_ROOT = path.join(import.meta.dir, '..', '..');
const ORIGINAL_CWD = process.cwd();

let root: string;
let project: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(path.join(PKG_ROOT, '.mochi-outdir-guard-'));
  project = path.join(root, 'app');
  outside = path.join(root, 'outside');
  mkdirSync(path.join(project, 'src'), { recursive: true });
  mkdirSync(path.join(project, 'public'));
  mkdirSync(outside);
  writeFileSync(path.join(project, 'src', 'Page.svelte'), '<h1>page</h1>\n');
  writeFileSync(path.join(project, 'public', 'favicon.ico'), 'icon');
  writeFileSync(path.join(outside, 'id_ed25519'), 'secret');
  process.chdir(project);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(root, { recursive: true, force: true });
});

const routes = () => ({ '/': Mochi.page('./src/Page.svelte') });

describe('an out-dir that holds project files', () => {
  test.each(['.', '..', './public', './src'])('--out-dir %s is refused and nothing is deleted', async (outDir) => {
    await expect(build({ routes: routes(), outDir })).rejects.toThrow('Refusing to clear');
    expect(existsSync(path.join(project, 'src', 'Page.svelte'))).toBe(true);
    expect(existsSync(path.join(project, 'public', 'favicon.ico'))).toBe(true);
    expect(existsSync(path.join(outside, 'id_ed25519'))).toBe(true);
  });
});

describe('a .mochi symlink to a directory outside the project', () => {
  // Unprivileged Windows refuses directory symlinks; a junction is the equivalent it always allows.
  const link = () => symlinkSync(outside, path.join(project, '.mochi'), process.platform === 'win32' ? 'junction' : 'dir');

  test('is refused when the target is not a previous build', async () => {
    link();
    await expect(build({ routes: routes() })).rejects.toThrow('Refusing to clear');
    expect(existsSync(path.join(outside, 'id_ed25519'))).toBe(true);
  });

  test('is still cleared when the target holds a previous build', async () => {
    rmSync(path.join(outside, 'id_ed25519'));
    mkdirSync(path.join(outside, 'svelte-compile'));
    writeFileSync(path.join(outside, 'svelte-compile', 'stale.js'), '');
    link();
    await build({ routes: routes() });
    expect(existsSync(path.join(outside, 'svelte-compile', 'stale.js'))).toBe(false);
    expect(existsSync(path.join(outside, 'manifest.json'))).toBe(true);
  });
});
