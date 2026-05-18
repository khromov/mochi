import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanPublicDir } from './publicDir';

describe('scanPublicDir', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-publicdir-test-'));
    writeFileSync(path.join(dir, 'favicon.ico'), 'icon');
    writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *\nDisallow:\n');
    mkdirSync(path.join(dir, '.well-known', 'acme-challenge'), { recursive: true });
    writeFileSync(path.join(dir, '.well-known', 'security.txt'), 'Contact: mailto:x@example.com\n');
    writeFileSync(path.join(dir, '.well-known', 'acme-challenge', 'token123'), 'challenge');
    mkdirSync(path.join(dir, 'img'), { recursive: true });
    writeFileSync(path.join(dir, 'img', 'logo.png'), 'png');
    writeFileSync(path.join(dir, '.hidden'), 'nope');
    writeFileSync(path.join(dir, '.env'), 'SECRET=nope');
    writeFileSync(path.join(dir, '.well-known', '.env'), 'SECRET=nope');
    mkdirSync(path.join(dir, '.git'), { recursive: true });
    writeFileSync(path.join(dir, '.git', 'config'), 'nope');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns common top-level files keyed by URL path', async () => {
    const files = await scanPublicDir(dir);
    expect(files.get('/favicon.ico')).toBe(`${dir}/favicon.ico`);
    expect(files.get('/robots.txt')).toBe(`${dir}/robots.txt`);
    expect(files.get('/img/logo.png')).toBe(`${dir}/img/logo.png`);
  });

  test('skips dotfiles at the root (including secrets like .env)', async () => {
    const files = await scanPublicDir(dir);
    expect(files.has('/.hidden')).toBe(false);
    expect(files.has('/.env')).toBe(false);
  });

  test('skips files inside non-whitelisted dot-directories (e.g. /.git/config)', async () => {
    const files = await scanPublicDir(dir);
    expect(files.has('/.git/config')).toBe(false);
  });

  test('serves /.well-known/ files (RFC 8615)', async () => {
    const files = await scanPublicDir(dir);
    expect(files.get('/.well-known/security.txt')).toBe(`${dir}/.well-known/security.txt`);
    expect(files.get('/.well-known/acme-challenge/token123')).toBe(`${dir}/.well-known/acme-challenge/token123`);
  });

  test('still skips dotfiles nested inside /.well-known/ (e.g. .env)', async () => {
    const files = await scanPublicDir(dir);
    expect(files.has('/.well-known/.env')).toBe(false);
  });

  test('returns an empty map when the directory does not exist', async () => {
    const files = await scanPublicDir(path.join(dir, 'does-not-exist'));
    expect(files.size).toBe(0);
  });

  test('strips a trailing slash from the base directory', async () => {
    const files = await scanPublicDir(`${dir}/`);
    expect(files.get('/favicon.ico')).toBe(`${dir}/favicon.ico`);
  });
});
