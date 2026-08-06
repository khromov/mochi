// checkEnvironment resolves svelte from the framework's own module location, not
// process.cwd() — so booting from a directory where svelte isn't resolvable (a
// monorepo root with an un-hoisted svelte, a non-root working dir) still works.
import { afterEach, expect, test } from 'bun:test';
import { checkEnvironment, compareVersions } from './checkEnvironment';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

test('resolves the installed Svelte version regardless of cwd', async () => {
  // `/` has no node_modules/svelte, so a cwd-anchored resolve would fail here.
  process.chdir('/');
  const { svelteVersion } = await checkEnvironment();
  expect(svelteVersion).toMatch(/^\d+\.\d+\.\d+/);
});

test('compareVersions handles equal, higher, lower, and prerelease suffixes', () => {
  expect(compareVersions('5.55.1', '5.55.1')).toBe(true);
  expect(compareVersions('5.56.0', '5.55.1')).toBe(true);
  expect(compareVersions('5.54.9', '5.55.1')).toBe(false);
  expect(compareVersions('1.3.14-canary.5', '1.3.14')).toBe(true);
  expect(compareVersions('1.3.15-canary.1', '1.3.14')).toBe(true);
  expect(compareVersions('1.3.13-canary.9', '1.3.14')).toBe(false);
});
