import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { error } from './utils';
import { mochiEvents } from './events';
import type { MochiErrorEvent, MochiRequestEvent } from './events';

describe('Mochi.file', () => {
  let server: Server<undefined>;
  let outDir: string;
  let fixturesDir: string;
  let outsideDir: string;
  let outsideSecretPath: string;
  let reportPath: string;
  let base: string;

  const REPORT_BODY = 'first line\nsecond line\n';

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-file-out-'));
    fixturesDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-file-fixtures-'));
    reportPath = path.join(fixturesDir, 'report.txt');
    await Bun.write(reportPath, REPORT_BODY);
    await Bun.write(path.join(fixturesDir, 'alpha.txt'), 'alpha contents');

    // A real file that lives outside the app root (process.cwd()) — must never
    // be servable, whether referenced absolutely or via `../` traversal.
    outsideDir = mkdtempSync(path.join(tmpdir(), 'mochi-file-outside-'));
    outsideSecretPath = path.join(outsideDir, 'secret.txt');
    await Bun.write(outsideSecretPath, 'top secret');

    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/files/report': Mochi.file(reportPath),
        '/files/dynamic/:name': Mochi.file((_req, params) => path.join(fixturesDir, `${params.name}.txt`)),
        '/files/escape/:name': Mochi.file((_req, params) => path.join(fixturesDir, params.name)),
        '/files/missing': Mochi.file(path.join(fixturesDir, 'does-not-exist.txt')),
        '/files/forced': Mochi.file(() => error(404, 'nope')),
        '/files/dir': Mochi.file(fixturesDir),
        '/files/outside': Mochi.file(outsideSecretPath),
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  test('serves a file from a string path with inferred Content-Type', async () => {
    const res = await fetch(`${base}/files/report`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toStartWith('text/plain');
    expect(await res.text()).toBe(REPORT_BODY);
  });

  test('resolver form receives route params', async () => {
    const res = await fetch(`${base}/files/dynamic/alpha`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('alpha contents');
  });

  test('missing file returns a plain-text 404', async () => {
    const res = await fetch(`${base}/files/missing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toStartWith('text/plain');
    expect(await res.text()).toBe('Not Found');
  });

  test('resolver may throw error() to force a status', async () => {
    const res = await fetch(`${base}/files/forced`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
  });

  test('HEAD on an existing file returns 200 with Content-Length but no body', async () => {
    const res = await fetch(`${base}/files/report`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(REPORT_BODY)));
    expect(res.headers.get('content-type') ?? '').toStartWith('text/plain');
    expect(await res.text()).toBe('');
  });

  test('HEAD on a missing file returns 404 with no body', async () => {
    const res = await fetch(`${base}/files/missing`, { method: 'HEAD' });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  test('a path pointing at a directory returns 404, not 500', async () => {
    const res = await fetch(`${base}/files/dir`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  test('an absolute path outside the app root returns 404 even though the file exists', async () => {
    const res = await fetch(`${base}/files/outside`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  test('encoded ../ traversal in a route param cannot escape the app root', async () => {
    // params are URL-decoded by the router, so an encoded `../` chain reaches
    // the resolver verbatim; the target file exists, proving the 404 comes
    // from root confinement rather than the exists() check.
    const escape = path.relative(fixturesDir, outsideSecretPath);
    const res = await fetch(`${base}/files/escape/${encodeURIComponent(escape)}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not Found');
  });

  test('emits request events with kind "file" and error events with kind "file"', async () => {
    const requests: MochiRequestEvent[] = [];
    const errors: MochiErrorEvent[] = [];
    const onRequest = (e: MochiRequestEvent) => requests.push(e);
    const onError = (e: MochiErrorEvent) => errors.push(e);
    mochiEvents.on('request', onRequest);
    mochiEvents.on('error', onError);
    try {
      await fetch(`${base}/files/report`);
      await fetch(`${base}/files/missing`);
    } finally {
      mochiEvents.off('request', onRequest);
      mochiEvents.off('error', onError);
    }
    expect(requests.some((e) => e.kind === 'file' && e.path === '/files/report' && e.status === 200)).toBe(true);
    expect(errors.some((e) => e.kind === 'file' && e.path === '/files/missing' && e.status === 404)).toBe(true);
  });
});
