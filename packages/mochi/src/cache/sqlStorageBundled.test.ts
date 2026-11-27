import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils';

const root = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-sqlcache-bundled-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SQL cache storage bundled into a chunk', () => {
  test('carries its schema inline, so it works wherever the chunk runs and whatever `mochi-framework` resolves to there', async () => {
    // An app whose reachable `mochi-framework` is some other copy without the cache's SQL files — what a lookup from
    // the chunk's own location finds in a global cache, an aliased install, or a future compiled build.
    const app = path.join(root, 'app');
    const decoy = path.join(app, 'node_modules', 'mochi-framework');
    mkdirSync(path.join(decoy, 'dist'), { recursive: true });
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'bundled-cache-app', private: true, type: 'module' }));
    writeFileSync(path.join(decoy, 'package.json'), JSON.stringify({ name: 'mochi-framework', version: '0.0.1', main: './dist/index.js' }));
    writeFileSync(path.join(decoy, 'dist', 'index.js'), 'export {};\n');

    const probe = path.join(root, 'probe.ts');
    writeFileSync(
      probe,
      `import { SqliteStorage } from ${JSON.stringify(toPosixPath(path.join(import.meta.dir, 'cache-storage.ts')))};
const storage = new SqliteStorage({ path: process.argv[2], purgeInterval: 0 });
try {
  await storage.setItem('k', { value: 1, createdAt: 1 });
  process.stdout.write('OK ' + JSON.stringify(await storage.getItem('k')));
} catch (err) {
  process.stdout.write('FAIL ' + (err && err.message ? err.message : String(err)));
}
await storage.dispose();
`,
    );
    const outdir = path.join(app, '.mochi', 'svelte-compile');
    const built = await Bun.build({ entrypoints: [probe], target: 'bun', outdir, naming: 'page.server.js', throw: false });
    expect(built.logs.map(String)).toEqual([]);
    expect(built.success).toBe(true);

    const chunk = path.join(outdir, 'page.server.js');
    const source = await Bun.file(chunk).text();
    expect(source).toContain('CREATE TABLE mochi_cache');
    expect(source).toContain('written_at bigint');
    expect(source).not.toContain('resolveSync');

    const proc = Bun.spawn([process.execPath, chunk, path.join(app, '.db', 'cache.sqlite')], { cwd: app, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(stdout + stderr).toBe('OK {"value":1,"createdAt":1}');
  }, 30_000);
});
