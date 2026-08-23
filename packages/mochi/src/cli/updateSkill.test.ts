import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatSkillDiff, updateSkill } from './updateSkill';

const SKILL_DEST = path.join('.claude', 'skills', 'mochi', 'SKILL.md');

function freshCwd() {
  return mkdtempSync(path.join(tmpdir(), 'mochi-skill-'));
}

describe('updateSkill', () => {
  it('defaults to the claude-code path and creates parent dirs when missing', async () => {
    const cwd = freshCwd();
    const fetchImpl = async () => new Response('# Hosted skill', { status: 200 });

    const res = await updateSkill({ cwd, fetchImpl });

    expect(res.created).toBe(true);
    expect(res.path).toBe(path.join(cwd, SKILL_DEST));
    expect(existsSync(res.path)).toBe(true);
    expect(await Bun.file(res.path).text()).toBe('# Hosted skill');
  });

  it('writes to the right path per target', async () => {
    const cases = [
      ['opencode', path.join('.opencode', 'skills', 'mochi', 'SKILL.md')],
      ['antigravity', path.join('.agents', 'skills', 'mochi', 'SKILL.md')],
      ['codex', path.join('.agents', 'skills', 'mochi', 'SKILL.md')],
    ] as const;

    for (const [target, expected] of cases) {
      const cwd = freshCwd();
      const fetchImpl = async () => new Response('body', { status: 200 });
      const res = await updateSkill({ cwd, target, fetchImpl });
      expect(res.path).toBe(path.join(cwd, expected));
      expect(await Bun.file(res.path).text()).toBe('body');
    }
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

  it('shows the diff before an existing skill is overwritten', async () => {
    const cwd = freshCwd();
    const dest = path.join(cwd, SKILL_DEST);
    await Bun.write(dest, 'stale content\n');
    const fetchImpl = async () => new Response('fresh content\n', { status: 200 });
    let previewed = false;

    const res = await updateSkill({
      cwd,
      fetchImpl,
      confirmUpdate: async ({ diff }) => {
        previewed = true;
        expect(await Bun.file(dest).text()).toBe('stale content\n');
        expect(diff).toContain('-stale content');
        expect(diff).toContain('+fresh content');
        return true;
      },
    });

    expect(previewed).toBe(true);
    expect(res.action).toBe('updated');
    expect(await Bun.file(dest).text()).toBe('fresh content\n');
  });

  it('leaves the existing skill untouched when the preview is rejected', async () => {
    const cwd = freshCwd();
    const dest = path.join(cwd, SKILL_DEST);
    await Bun.write(dest, 'trusted content');
    const fetchImpl = async () => new Response('unsigned replacement', { status: 200 });

    const res = await updateSkill({ cwd, fetchImpl, confirmUpdate: () => false });

    expect(res.action).toBe('aborted');
    expect(await Bun.file(dest).text()).toBe('trusted content');
  });

  it('creates the file even when the hosted body is empty', async () => {
    const cwd = freshCwd();
    const dest = path.join(cwd, SKILL_DEST);
    const fetchImpl = async () => new Response('', { status: 200 });

    const res = await updateSkill({ cwd, fetchImpl });

    expect(res.action).toBe('created');
    expect(res.created).toBe(true);
    expect(existsSync(dest)).toBe(true);
  });

  it('writes a first-time skill without asking, since there is nothing to review', async () => {
    const cwd = freshCwd();
    const fetchImpl = async () => new Response('fresh content', { status: 200 });
    let asked = false;

    const res = await updateSkill({
      cwd,
      fetchImpl,
      confirmUpdate: () => {
        asked = true;
        return false;
      },
    });

    expect(asked).toBe(false);
    expect(res.action).toBe('created');
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

describe('formatSkillDiff', () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);

  it('emits one hunk per cluster of changes rather than one spanning the file', () => {
    const before = body(60);
    const after = body(60);
    after[2] = 'line 2 CHANGED';
    after[55] = 'line 55 CHANGED';

    const diff = formatSkillDiff(before.join('\n'), after.join('\n'), '/tmp/SKILL.md', 'https://mochi.fast/SKILL.md');
    const hunks = diff.split('\n').filter((line) => line.startsWith('@@'));
    const removed = diff
      .split('\n')
      .slice(2)
      .filter((line) => line.startsWith('-'));

    expect(hunks).toHaveLength(2);
    expect(removed).toEqual(['-line 2', '-line 55']);
    expect(diff).toContain('+line 2 CHANGED');
    expect(diff).toContain('+line 55 CHANGED');
    // The 50 untouched lines between the two edits stay out of the output entirely.
    expect(diff).not.toContain('line 30');
  });

  it('merges neighbouring changes into a single hunk', () => {
    const before = body(30);
    const after = body(30);
    after[10] = 'line 10 CHANGED';
    after[12] = 'line 12 CHANGED';

    const diff = formatSkillDiff(before.join('\n'), after.join('\n'), '/tmp/SKILL.md', 'https://mochi.fast/SKILL.md');

    expect(diff.split('\n').filter((line) => line.startsWith('@@'))).toHaveLength(1);
  });

  it('labels a first write against /dev/null', () => {
    const diff = formatSkillDiff('', 'hello\n', '/tmp/SKILL.md', 'https://mochi.fast/SKILL.md');

    expect(diff.startsWith('--- /dev/null\n+++ https://mochi.fast/SKILL.md\n@@ -1,0 +1,1 @@\n+hello')).toBe(true);
  });
});
