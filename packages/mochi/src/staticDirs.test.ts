import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from './Mochi';
import { resolveStaticDirs } from './runtime/staticDirs';

// An outDir must live inside the project tree — see CLAUDE.md; this file sits at src/, so one level up.
const root = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-staticdirs-'));
const media = path.join(root, 'media');
mkdirSync(path.join(media, 'nested'), { recursive: true });
writeFileSync(path.join(media, 'hello.txt'), 'hello from a mount');
writeFileSync(path.join(media, 'nested', 'index.html'), '<!doctype html><p>nested index</p>');
writeFileSync(path.join(media, '.env'), 'SECRET=1');

let server: Server<undefined> | undefined;

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe('resolveStaticDirs', () => {
  test('normalizes a trailing slash and builds the wildcard pattern', () => {
    expect(resolveStaticDirs({ '/assets/': media }, '/_mochi')[0]!.pattern).toBe('/assets/*');
  });

  // A root mount would have to register the global catch-all, which answers every unmatched request with Bun's own
  // 404 — the error page, the fetch fallback and /_mochi/* asset serving would all stop running.
  test('refuses to mount the site root', () => {
    expect(() => resolveStaticDirs({ '/': './media' }, '/_mochi')).toThrow(/cannot be mounted/);
  });

  test('rejects a prefix that is not absolute', () => {
    expect(() => resolveStaticDirs({ assets: './media' }, '/_mochi')).toThrow(/must start with "\/"/);
  });

  test('rejects params and wildcards in the prefix', () => {
    expect(() => resolveStaticDirs({ '/a/*': './media' }, '/_mochi')).toThrow(/must be a literal path/);
    expect(() => resolveStaticDirs({ '/a/:id': './media' }, '/_mochi')).toThrow(/must be a literal path/);
  });

  test('rejects a mount inside the framework asset prefix', () => {
    expect(() => resolveStaticDirs({ '/_mochi/sneaky': './media' }, '/_mochi')).toThrow(/inside the framework asset prefix/);
  });

  test('rejects the same prefix twice', () => {
    expect(() => resolveStaticDirs({ '/a': media, '/a/': media }, '/_mochi')).toThrow(/mounted twice/);
  });

  test('resolves the directory to an absolute path', () => {
    expect(path.isAbsolute(resolveStaticDirs({ '/assets': path.relative(process.cwd(), media) }, '/_mochi')[0]!.dir)).toBe(true);
  });

  // Bun's directory route resolves per request, so without this the typo is a bare ENOENT naming neither the option nor the prefix.
  test('rejects a directory that does not exist', () => {
    expect(() => resolveStaticDirs({ '/assets': path.join(root, 'nope') }, '/_mochi')).toThrow(/does not exist/);
  });

  test('rejects a path that is a file', () => {
    expect(() => resolveStaticDirs({ '/assets': path.join(media, 'hello.txt') }, '/_mochi')).toThrow(/is a file, not a directory/);
  });
});

describe('Mochi.serve({ staticDirs })', () => {
  test('serves the tree, and framework routes still work alongside it', async () => {
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir: path.join(root, '.mochi'),
      publicDir: path.join(root, 'no-public'),
      staticDirs: { '/assets': media },
      routes: { '/api/ping': Mochi.api(() => Response.json({ ok: true })) },
    });
    const base = `http://localhost:${server.port}`;

    const file = await fetch(`${base}/assets/hello.txt`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('hello from a mount');
    // Range and ETag come from Bun's directory route, not from us.
    expect(file.headers.get('etag')).toBeTruthy();

    const ranged = await fetch(`${base}/assets/hello.txt`, { headers: { Range: 'bytes=0-4' } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('hello');

    const notModified = await fetch(`${base}/assets/hello.txt`, { headers: { 'If-None-Match': file.headers.get('etag')! } });
    expect(notModified.status).toBe(304);

    expect(await (await fetch(`${base}/assets/nested/`)).text()).toContain('nested index');

    expect((await fetch(`${base}/assets/missing.txt`)).status).toBe(404);

    // The mount is a scoped wildcard, so a declared route and the framework's own routes are untouched.
    expect(await (await fetch(`${base}/api/ping`)).json()).toEqual({ ok: true });
    // An unmatched path still reaches Mochi rather than Bun's bare directory-route 404.
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test('a mount does not filter dotfiles the way publicDir does', async () => {
    // Documented, not desired: Bun's directory route serves everything under the directory.
    expect((await fetch(`http://localhost:${server!.port}/assets/.env`)).status).toBe(200);
  });

  test('serves a percent-encoded filename', async () => {
    writeFileSync(path.join(media, 'a b.txt'), 'spaced');
    const res = await fetch(`http://localhost:${server!.port}/assets/a%20b.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('spaced');
  });

  // Bun clamps the mount: an encoded separator or a traversal segment never resolves outside the directory.
  test('rejects encoded separators and path traversal', async () => {
    writeFileSync(path.join(root, 'outside.txt'), 'should never be served');
    const base = `http://localhost:${server!.port}`;
    expect((await fetch(`${base}/assets/sub%2Fdeep.txt`)).status).toBe(404);
    expect((await fetch(`${base}/assets/../outside.txt`)).status).toBe(404);
    expect((await fetch(`${base}/assets/%2E%2E/outside.txt`)).status).toBe(404);
    expect(await (await fetch(`${base}/assets/../outside.txt`)).text()).not.toContain('should never be served');
  });
});
