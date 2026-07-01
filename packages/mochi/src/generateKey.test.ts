import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKey } from './generateKey';

function freshCwd() {
  return mkdtempSync(path.join(tmpdir(), 'mochi-key-'));
}

const KEY = 'AAAA';

describe('generateKey', () => {
  it('creates .env with MOCHI_KEY when the file is absent', async () => {
    const cwd = freshCwd();

    const res = await generateKey({ cwd, key: KEY });

    expect(res.action).toBe('created');
    expect(res.path).toBe(path.join(cwd, '.env'));
    expect(await Bun.file(res.path).text()).toBe(`MOCHI_KEY=${KEY}\n`);
  });

  it('generates a key that decodes to exactly 32 bytes', async () => {
    const cwd = freshCwd();

    const res = await generateKey({ cwd });

    expect(Buffer.from(res.key, 'base64url').length).toBe(32);
    expect(await Bun.file(res.path).text()).toBe(`MOCHI_KEY=${res.key}\n`);
  });

  it('appends to an existing .env that has no MOCHI_KEY, preserving content', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    await Bun.write(envPath, 'PORT=3333\nFOO=bar\n');

    const res = await generateKey({ cwd, key: KEY });

    expect(res.action).toBe('appended');
    expect(await Bun.file(envPath).text()).toBe(`PORT=3333\nFOO=bar\nMOCHI_KEY=${KEY}\n`);
  });

  it('inserts a separating newline when the existing .env lacks a trailing one', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    await Bun.write(envPath, 'PORT=3333');

    await generateKey({ cwd, key: KEY });

    expect(await Bun.file(envPath).text()).toBe(`PORT=3333\nMOCHI_KEY=${KEY}\n`);
  });

  it('replaces an existing MOCHI_KEY in place when force is set, leaving other lines intact', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    await Bun.write(envPath, `PORT=3333\nMOCHI_KEY=old\nFOO=bar\n`);

    const res = await generateKey({ cwd, key: KEY, force: true });

    expect(res.action).toBe('replaced');
    expect(await Bun.file(envPath).text()).toBe(`PORT=3333\nMOCHI_KEY=${KEY}\nFOO=bar\n`);
  });

  it('aborts without touching the file when overwrite is declined', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    const original = `MOCHI_KEY=old\n`;
    await Bun.write(envPath, original);

    const res = await generateKey({ cwd, key: KEY, confirmOverwrite: () => false });

    expect(res.action).toBe('aborted');
    expect(await Bun.file(envPath).text()).toBe(original);
  });

  it('replaces when overwrite is confirmed', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    await Bun.write(envPath, `MOCHI_KEY=old\n`);

    const res = await generateKey({ cwd, key: KEY, confirmOverwrite: () => true });

    expect(res.action).toBe('replaced');
    expect(await Bun.file(envPath).text()).toBe(`MOCHI_KEY=${KEY}\n`);
  });

  it('does not treat a commented-out MOCHI_KEY as an existing key', async () => {
    const cwd = freshCwd();
    const envPath = path.join(cwd, '.env');
    await Bun.write(envPath, `# MOCHI_KEY=old\n`);

    const res = await generateKey({ cwd, key: KEY });

    expect(res.action).toBe('appended');
    expect(await Bun.file(envPath).text()).toBe(`# MOCHI_KEY=old\nMOCHI_KEY=${KEY}\n`);
  });
});
