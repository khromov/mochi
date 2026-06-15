import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLI = path.join(import.meta.dir, 'cli.ts');

function freshCwd() {
  return mkdtempSync(path.join(tmpdir(), 'mochi-cli-'));
}

// Runs the real CLI as a subprocess, with MOCHI_SKILL_URL pointed at a local
// server so the end-to-end path is exercised without depending on the network
// (the live https://mochi.fast/SKILL.md still 404s).
async function runUpdateSkill(cwd: string, skillUrl: string, agent?: string) {
  const proc = Bun.spawn([process.execPath, CLI, 'update-skill', ...(agent ? [agent] : [])], {
    cwd,
    env: { ...process.env, MOCHI_SKILL_URL: skillUrl },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
}

describe('mochi-framework update-skill (subprocess)', () => {
  it('fetches the skill and writes it to the claude-code path', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('# Hosted skill body', { status: 200 }) });
    const cwd = freshCwd();
    try {
      const { exitCode } = await runUpdateSkill(cwd, server.url.href);

      expect(exitCode).toBe(0);
      const dest = path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md');
      expect(existsSync(dest)).toBe(true);
      expect(await Bun.file(dest).text()).toBe('# Hosted skill body');
    } finally {
      server.stop(true);
    }
  });

  it('writes to the agent-specific path when an agent is passed', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('body', { status: 200 }) });
    const cwd = freshCwd();
    try {
      const { exitCode } = await runUpdateSkill(cwd, server.url.href, 'opencode');

      expect(exitCode).toBe(0);
      expect(existsSync(path.join(cwd, '.opencode', 'skills', 'mochi', 'SKILL.md'))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  // Mirrors the current live behavior: the hosted SKILL.md is not published yet,
  // so the CLI must fail cleanly without writing anything.
  it('exits non-zero and writes nothing when the source 404s', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('not found', { status: 404 }) });
    const cwd = freshCwd();
    try {
      const { exitCode, stderr } = await runUpdateSkill(cwd, server.url.href);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('HTTP 404');
      expect(existsSync(path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md'))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
