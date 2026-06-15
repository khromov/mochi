import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { updateSkill } from './updateSkill';

const SKILL_DEST = path.join('.claude', 'skills', 'mochi', 'SKILL.md');

function freshCwd() {
  return mkdtempSync(path.join(tmpdir(), 'mochi-skill-'));
}

describe('updateSkill', () => {
  it('creates the skill file (and parent dirs) when it does not exist', async () => {
    const cwd = freshCwd();
    const fetchImpl = async () => new Response('# Hosted skill', { status: 200 });

    const res = await updateSkill({ cwd, fetchImpl });

    expect(res.created).toBe(true);
    expect(res.path).toBe(path.join(cwd, SKILL_DEST));
    expect(existsSync(res.path)).toBe(true);
    expect(await Bun.file(res.path).text()).toBe('# Hosted skill');
  });

  it('overwrites an existing skill file', async () => {
    const cwd = freshCwd();
    const dest = path.join(cwd, SKILL_DEST);
    await Bun.write(dest, 'stale content');
    const fetchImpl = async () => new Response('fresh content', { status: 200 });

    const res = await updateSkill({ cwd, fetchImpl });

    expect(res.created).toBe(false);
    expect(await Bun.file(res.path).text()).toBe('fresh content');
  });

  it('throws a helpful error when the URL 404s', async () => {
    const cwd = freshCwd();
    const fetchImpl = async () => new Response('Not found', { status: 404 });

    await expect(updateSkill({ cwd, fetchImpl })).rejects.toThrow(/HTTP 404/);
    expect(existsSync(path.join(cwd, SKILL_DEST))).toBe(false);
  });

  it('wraps a network error with the unreachable-URL message', async () => {
    const cwd = freshCwd();
    const url = 'https://mochi.fast/SKILL.md';
    const fetchImpl = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };

    await expect(updateSkill({ cwd, url, fetchImpl })).rejects.toThrow(/Could not reach https:\/\/mochi\.fast\/SKILL\.md/);
    expect(existsSync(path.join(cwd, SKILL_DEST))).toBe(false);
  });
});
