import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalFilesHandler, localFile, localFileBytes, resolveLocalDirFile, resolveLocalDirs } from './localDirs';
import type { ResolvedLocalDirs } from './localDirs';
import { toPosixPath } from '../utils';

const GLOBAL_CONFIG_KEY = '__mochi_config__';
const GLOBAL_DIRS_KEY = '__mochi_local_dirs__';

function installConfig(options: Record<string, unknown> = {}): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = {
    options,
    secretKey: Buffer.from('test-key-for-unit-tests-32bytes!'),
  };
}

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function media(root: string, includeDotfiles = false): ResolvedLocalDirs {
  return { media: { root, includeDotfiles } };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_DIRS_KEY];
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

const TXT_BODY = 'first line\nsecond line\n';

describe('resolveLocalDirs', () => {
  test('accepts string shorthand and object form, resolving roots to absolute paths', () => {
    const resolved = resolveLocalDirs({ media: './uploads', secrets: { root: './data', includeDotfiles: true } });
    expect(resolved.media).toEqual({ root: expect.stringMatching(/^\//) as unknown as string, includeDotfiles: false });
    expect(resolved.media?.root.endsWith('/uploads')).toBe(true);
    expect(resolved.secrets).toMatchObject({ includeDotfiles: true });
  });

  test('defaults to an empty map for undefined', () => {
    expect(Object.keys(resolveLocalDirs(undefined))).toEqual([]);
  });

  test('throws on a dir name that cannot appear in a URL segment', () => {
    for (const name of ['has space', 'a/b', 'dots.dot', '', 'ünïcode']) {
      expect(() => resolveLocalDirs({ [name]: './x' })).toThrow(/localDirs name/);
    }
  });

  test('throws on an empty root', () => {
    expect(() => resolveLocalDirs({ media: '' })).toThrow(/root must be a non-empty path/);
    expect(() => resolveLocalDirs({ media: { root: '' } })).toThrow(/root must be a non-empty path/);
  });

  test('the resolved map has a null prototype (URL-derived names cannot hit the prototype chain)', () => {
    const resolved = resolveLocalDirs({ media: './uploads' });
    expect(Object.getPrototypeOf(resolved)).toBeNull();
    expect((resolved as Record<string, unknown>).toString).toBeUndefined();
  });
});

describe('resolveLocalDirFile', () => {
  test('resolves a nested path inside a configured root with the right content type', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const hit = resolveLocalDirFile('/_mochi/files/media/sub/cat.png', media(root));
    expect(hit).toBeDefined();
    expect(toPosixPath(hit!.diskPath)).toBe(toPosixPath(join(root, 'sub/cat.png')));
    expect(hit!.contentType).toBe('image/png');
  });

  test('serves any file type — content type follows the extension', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const type = (rel: string) => resolveLocalDirFile(`/_mochi/files/media/${rel}`, media(root))?.contentType;
    expect(type('notes.txt')).toBe('text/plain;charset=utf-8');
    expect(type('album.zip')).toBe('application/zip');
    expect(type('song.mp3')).toBe('audio/mpeg');
    expect(type('photo.JPG')).toBe('image/jpeg');
    expect(type('blob')).toBe('application/octet-stream');
  });

  test('honors a custom assetPrefix', () => {
    installConfig({ assetPrefix: '/custom' });
    const root = tempDir('mochi-localdirs-');
    expect(resolveLocalDirFile('/custom/files/media/cat.png', media(root))).toBeDefined();
    expect(resolveLocalDirFile('/_mochi/files/media/cat.png', media(root))).toBeUndefined();
  });

  test.each([
    ['unknown dir name', '/_mochi/files/other/cat.png'],
    ['no relative path', '/_mochi/files/media'],
    ['empty relative path', '/_mochi/files/media/'],
    ['plain ../ traversal', '/_mochi/files/media/../escape.png'],
    ['encoded ../ traversal', '/_mochi/files/media/%2e%2e%2fescape.png'],
    ['absolute nested path', '/_mochi/files/media//etc/passwd.png'],
    ['encoded absolute path', '/_mochi/files/media/%2Fetc%2Fpasswd.png'],
    ['dot-slash escape chain', '/_mochi/files/media/.%2F..%2Fescape.png'],
    ['double-encoded null byte', '/_mochi/files/media/a%00.png'],
    ['prototype-chain dir name', '/_mochi/files/constructor/cat.png'],
    ['outside the files prefix', '/_mochi/asset/cat.png'],
  ])('rejects %s', (_label, pathname) => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    expect(resolveLocalDirFile(pathname, media(root))).toBeUndefined();
  });

  test('a ../ chain cannot escape into a sibling directory', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const other = tempDir('mochi-localdirs-other-');
    const escape = `/_mochi/files/media/${encodeURIComponent(`../${other.split('/').pop()}/secret.png`)}`;
    expect(resolveLocalDirFile(escape, { ...media(root), other: { root: other, includeDotfiles: false } })).toBeUndefined();
  });

  test('refuses dotfile paths by default, at any depth', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    for (const rel of ['.env', '.git/config', 'sub/.hidden.png']) {
      expect(resolveLocalDirFile(`/_mochi/files/media/${rel}`, media(root))).toBeUndefined();
    }
  });

  test('allows a leading .well-known segment (same policy as Mochi.file/publicDir)', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    expect(resolveLocalDirFile('/_mochi/files/media/.well-known/security.txt', media(root))).toBeDefined();
  });

  test('includeDotfiles: true serves dotfiles for that dir only', () => {
    installConfig();
    const root = tempDir('mochi-localdirs-');
    const other = tempDir('mochi-localdirs-other-');
    const both: ResolvedLocalDirs = { open: { root, includeDotfiles: true }, closed: { root: other, includeDotfiles: false } };
    expect(resolveLocalDirFile('/_mochi/files/open/.env', both)).toBeDefined();
    expect(resolveLocalDirFile('/_mochi/files/closed/.env', both)).toBeUndefined();
  });
});

describe('createLocalFilesHandler', () => {
  async function setup(development: boolean) {
    const root = tempDir('mochi-localdirs-');
    installConfig({ localDirs: { media: root } });
    mkdirSync(join(root, 'sub'));
    await Bun.write(join(root, 'sub', 'notes.txt'), TXT_BODY);
    return { root, handler: createLocalFilesHandler(development) };
  }

  test('serves bytes with revalidation headers in production', async () => {
    const { handler } = await setup(false);
    const res = await handler(new Request('http://localhost/_mochi/files/media/sub/notes.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain;charset=utf-8');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('Last-Modified')).toBeTruthy();
    expect(await res.text()).toBe(TXT_BODY);
  });

  test('replies 304 to a fresh If-Modified-Since and 200 to a stale one', async () => {
    const { root, handler } = await setup(false);
    const first = await handler(new Request('http://localhost/_mochi/files/media/sub/notes.txt'));
    const lastModified = first.headers.get('Last-Modified')!;
    const fresh = await handler(new Request('http://localhost/_mochi/files/media/sub/notes.txt', { headers: { 'If-Modified-Since': lastModified } }));
    expect(fresh.status).toBe(304);
    // Bump the file's mtime past the client's snapshot → full 200 again.
    const later = new Date(Date.parse(lastModified) + 2_000);
    utimesSync(join(root, 'sub', 'notes.txt'), later, later);
    const stale = await handler(new Request('http://localhost/_mochi/files/media/sub/notes.txt', { headers: { 'If-Modified-Since': lastModified } }));
    expect(stale.status).toBe(200);
  });

  test('sends no cache headers in development', async () => {
    const { handler } = await setup(true);
    const res = await handler(new Request('http://localhost/_mochi/files/media/sub/notes.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeNull();
    expect(res.headers.get('Last-Modified')).toBeNull();
  });

  test('404s a missing file, a traversal attempt, and a dotfile', async () => {
    const { root, handler } = await setup(false);
    await Bun.write(join(root, '.env'), 'SECRET=1');
    expect((await handler(new Request('http://localhost/_mochi/files/media/nope.txt'))).status).toBe(404);
    expect((await handler(new Request('http://localhost/_mochi/files/media/%2e%2e%2fnotes.txt'))).status).toBe(404);
    expect((await handler(new Request('http://localhost/_mochi/files/media/.env'))).status).toBe(404);
  });
});

describe('localFile / localFileBytes', () => {
  async function setup(includeDotfiles = false) {
    const root = tempDir('mochi-localdirs-');
    installConfig({ localDirs: { media: includeDotfiles ? { root, includeDotfiles: true } : root } });
    await Bun.write(join(root, 'notes.txt'), TXT_BODY);
    return root;
  }

  test('returns url + metadata for a configured-dir file', async () => {
    await setup();
    const before = Date.now();
    const f = await localFile('media/notes.txt');
    expect(f.url).toBe('/_mochi/files/media/notes.txt');
    expect(f.size).toBe(Buffer.byteLength(TXT_BODY));
    expect(f.contentType).toBe('text/plain;charset=utf-8');
    expect(Math.abs(f.lastModified - before)).toBeLessThan(60_000);
  });

  test('URL-encodes path segments and tolerates a leading slash', async () => {
    const root = await setup();
    await Bun.write(join(root, 'my file.txt'), 'x');
    expect((await localFile('media/my file.txt')).url).toBe('/_mochi/files/media/my%20file.txt');
    expect((await localFile('/media/notes.txt')).url).toBe('/_mochi/files/media/notes.txt');
  });

  test('localFileBytes round-trips the bytes', async () => {
    await setup();
    expect(new TextDecoder().decode(await localFileBytes('media/notes.txt'))).toBe(TXT_BODY);
  });

  test('throws helpful errors for unknown dirs, refused dotfiles, and missing files', async () => {
    const root = await setup();
    await Bun.write(join(root, '.env'), 'SECRET=1');
    await expect(localFile('other/notes.txt')).rejects.toThrow(/localDirs \("media"\)/);
    await expect(localFile('media/.env')).rejects.toThrow(/includeDotfiles/);
    await expect(localFile('media/missing.txt')).rejects.toThrow(/file not found/);
    await expect(localFileBytes('media/missing.txt')).rejects.toThrow(/file not found/);
  });

  test('includeDotfiles: true lets localFile read a dotfile', async () => {
    const root = await setup(true);
    await Bun.write(join(root, '.env'), 'SECRET=1');
    expect((await localFile('media/.env')).size).toBe(8);
  });
});
