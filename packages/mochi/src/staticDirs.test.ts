import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
mkdirSync(path.join(media, '.git'));
writeFileSync(path.join(media, '.git', 'config'), 'url = https://SECRET@example.com/repo');
writeFileSync(path.join(media, 'nested', '.env'), 'NESTED_SECRET=1');
writeFileSync(path.join(media, '.x#y'), 'HASH_SECRET=1');
writeFileSync(path.join(media, '.x[y'), 'BRACKET_SECRET=1');
writeFileSync(path.join(media, '.a+b#c'), 'PLUS_SECRET=1');
writeFileSync(path.join(media, '.café'), 'ACCENT_SECRET=1');
mkdirSync(path.join(media, 'café'));
writeFileSync(path.join(media, 'café', '.npmrc'), 'CAFE_SECRET=1');
writeFileSync(path.join(media, 'café', 'menu.txt'), 'espresso');
mkdirSync(path.join(media, '.well-known'));
writeFileSync(path.join(media, '.well-known', 'security.txt'), 'Contact: mailto:security@example.com');
mkdirSync(path.join(root, 'outside'));
writeFileSync(path.join(root, 'outside', 'secret.txt'), 'OUTSIDE_SECRET=1');
// Relative on POSIX, where Bun's native directory route re-roots an absolute target; Windows junctions need an absolute one.
const link = (target: string, name: string): void => symlinkSync(process.platform === 'win32' ? path.resolve(media, target) : target, path.join(media, name), 'junction');
link('nested', 'linked');
link('.git', 'gitlink');
link('../outside', 'escape');
link('nested', '.alias');

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
    expect(file.headers.get('content-type')).toBe('text/plain;charset=utf-8');
    expect(file.headers.get('etag')).toBeTruthy();

    const head = await fetch(`${base}/assets/hello.txt`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('18');
    expect(await head.text()).toBe('');

    const ranged = await fetch(`${base}/assets/hello.txt`, { headers: { Range: 'bytes=0-4' } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('hello');

    // Range comes from Bun's file response, but the conditional 304s are the mount handler's own.
    const notModified = await fetch(`${base}/assets/hello.txt`, { headers: { 'If-None-Match': file.headers.get('etag')! } });
    expect(notModified.status).toBe(304);
    const notModifiedSince = await fetch(`${base}/assets/hello.txt`, { headers: { 'If-Modified-Since': file.headers.get('last-modified')! } });
    expect(notModifiedSince.status).toBe(304);

    expect(await (await fetch(`${base}/assets/nested/`)).text()).toContain('nested index');
    const toSlash = await fetch(`${base}/assets/nested?x=1`, { redirect: 'manual' });
    expect(toSlash.status).toBe(301);
    expect(toSlash.headers.get('location')).toBe('/assets/nested/?x=1');

    expect((await fetch(`${base}/assets/missing.txt`)).status).toBe(404);

    // The mount is a scoped wildcard, so a declared route and the framework's own routes are untouched.
    expect(await (await fetch(`${base}/api/ping`)).json()).toEqual({ ok: true });
    // An unmatched path still reaches Mochi rather than the mount's bare 404.
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test('refuses dotfiles and dot-directories like publicDir, apart from .well-known', async () => {
    const base = `http://localhost:${server!.port}`;
    // Written after boot, so only a per-request check can refuse it.
    writeFileSync(path.join(media, '.late'), 'LATE_SECRET=1');
    const plain = ['/assets/.env', '/assets/nested/.env', '/assets/.git/config', '/assets/.git/', '/assets/.git', '/assets/.late'];
    // Raw, encoded, mixed-case and half-encoded spellings all decode to a dot name.
    const spellings = ['/assets/.x[y', '/assets/.x%5By', '/assets/.x%5by', '/assets/.x%23y', '/assets/.a+b%23c', '/assets/%2Eenv', '/assets/.caf%c3%A9'];
    const underAccent = ['/assets/caf%C3%A9/.npmrc', '/assets/caf%c3%a9/.npmrc', '/assets/caf%C3%a9/.npmrc'];
    // These open `.env` and `.git/config` on a case-insensitive filesystem (macOS, Windows).
    const caseFolded = ['/assets/.ENV', '/assets/.GIT/config'];
    // A dot name under a linked directory, a plain name resolving to a dot entry, and the reverse.
    const symlinked = ['/assets/linked/.env', '/assets/gitlink/config', '/assets/.alias/index.html'];
    for (const p of [...plain, ...spellings, ...underAccent, ...caseFolded, ...symlinked]) {
      const res = await fetch(`${base}${p}`);
      expect({ p, status: res.status }).toEqual({ p, status: 404 });
      expect(await res.text()).not.toContain('SECRET');
    }
    expect(await (await fetch(`${base}/assets/.well-known/security.txt`)).text()).toContain('Contact:');
    expect(await (await fetch(`${base}/assets/linked/index.html`)).text()).toContain('nested index');
    for (const p of ['/assets/café/menu.txt', '/assets/caf%c3%a9/menu.txt', '/assets/caf%c3%A9/menu.txt']) {
      expect(await (await fetch(`${base}${p}`)).text()).toBe('espresso');
    }
  });

  test('serves a percent-encoded filename', async () => {
    writeFileSync(path.join(media, 'a b.txt'), 'spaced');
    const res = await fetch(`http://localhost:${server!.port}/assets/a%20b.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('spaced');
  });

  test('rejects encoded separators, path traversal and symlinks that leave the mount', async () => {
    writeFileSync(path.join(root, 'outside.txt'), 'OUTSIDE_SECRET=1');
    const base = `http://localhost:${server!.port}`;
    const escapes = ['/assets/hel%00lo.txt', '/assets/sub%2Fdeep.txt', '/assets/../outside.txt', '/assets/%2E%2E/outside.txt', '/assets/..%2Foutside.txt'];
    for (const p of [...escapes, '/assets/nested/..%2F..%2Foutside.txt', '/assets/escape/secret.txt']) {
      const res = await fetch(`${base}${p}`);
      expect({ p, status: res.status }).toEqual({ p, status: 404 });
      expect(await res.text()).not.toContain('SECRET');
    }
  });
});
