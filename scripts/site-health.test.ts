import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dir, 'site-health.ts');

// A stand-in for Chrome that records the flags it was launched with and then exits, so no real browser is needed.
describe.skipIf(process.platform === 'win32')('site-health Chrome flags', () => {
  let dir: string;
  let fakeChrome: string;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'site-health-'));
    fakeChrome = path.join(dir, 'chrome');
    writeFileSync(fakeChrome, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$FAKE_CHROME_LOG"\nexit 1\n');
    chmodSync(fakeChrome, 0o755);
    server = Bun.serve({
      port: 0,
      fetch: () => new Response('<urlset><url><loc>https://mochi.fast/</loc></url></urlset>'),
    });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  const chromeArgv = async (ci: string | undefined) => {
    const log = path.join(dir, `argv-${ci ?? 'local'}.log`);
    const env: Record<string, string | undefined> = { ...process.env, BUN_CHROME_PATH: fakeChrome, FAKE_CHROME_LOG: log, CI: ci };
    if (ci === undefined) {
      delete env.CI;
    }
    const proc = Bun.spawn(['bun', SCRIPT, `http://127.0.0.1:${server.port}`, '--report', path.join(dir, 'REPORT.md')], {
      env,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    expect(await proc.exited).toBe(2);
    return (await Bun.file(log).text()).split('\n');
  };

  test('keeps the Chrome sandbox on outside CI', async () => {
    expect(await chromeArgv(undefined)).not.toContain('--no-sandbox');
  });

  test('disables the Chrome sandbox under CI, where runners cannot initialize it', async () => {
    expect(await chromeArgv('true')).toContain('--no-sandbox');
  });
});
