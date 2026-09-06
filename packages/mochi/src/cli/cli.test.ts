import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SKILL_TARGETS } from './updateSkill';

const CLI = path.join(import.meta.dir, 'cli.ts');

function freshCwd() {
  return mkdtempSync(path.join(tmpdir(), 'mochi-cli-'));
}

async function runCli(...args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode, stdout, stderr };
}

// Runs the real CLI as a subprocess, with MOCHI_SKILL_URL pointed at a local
// server so the end-to-end path is exercised without depending on the network
// (the live https://mochi.fast/SKILL.md still 404s).
async function runUpdateSkill(cwd: string, skillUrl: string, agent?: string, flags: string[] = ['--force']) {
  const proc = Bun.spawn([process.execPath, CLI, 'update-skill', ...(agent ? [agent] : []), ...flags], {
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
      const { exitCode, stdout } = await runUpdateSkill(cwd, server.url.href);

      expect(exitCode).toBe(0);
      // Nothing to review on a first write, so the confirmation preview stays out of the way.
      expect(stdout).not.toContain('Skill update fetched');
      const dest = path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md');
      expect(existsSync(dest)).toBe(true);
      expect(await Bun.file(dest).text()).toBe('# Hosted skill body');
    } finally {
      server.stop(true);
    }
  });

  it('shows the diff and applies an overwrite under --force', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('# Hosted skill body', { status: 200 }) });
    const cwd = freshCwd();
    const dest = path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md');
    await Bun.write(dest, '# Stale skill body');
    try {
      const { exitCode, stdout } = await runUpdateSkill(cwd, server.url.href);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Skill update fetched');
      expect(stdout).toContain('+# Hosted skill body');
      expect(await Bun.file(dest).text()).toBe('# Hosted skill body');
    } finally {
      server.stop(true);
    }
  });

  // Without --force and without a terminal, confirm() would read false at EOF and quietly exit 0 having written nothing.
  it('fails loudly instead of silently declining an overwrite with no terminal attached', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('# Hosted skill body', { status: 200 }) });
    const cwd = freshCwd();
    const dest = path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md');
    await Bun.write(dest, '# Stale skill body');
    try {
      const { exitCode, stderr } = await runUpdateSkill(cwd, server.url.href, undefined, []);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--force');
      expect(await Bun.file(dest).text()).toBe('# Stale skill body');
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

  // The canonical name and its `agy` alias must both resolve to the .agents path.
  it.each(['antigravity', 'agy'])('accepts %s and writes to the .agents path', async (agent) => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('body', { status: 200 }) });
    const cwd = freshCwd();
    try {
      const { exitCode } = await runUpdateSkill(cwd, server.url.href, agent);

      expect(exitCode).toBe(0);
      expect(existsSync(path.join(cwd, '.agents', 'skills', 'mochi', 'SKILL.md'))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  // Guards the derived-from-map text: every target (and the agy alias) must appear
  // in --help, so adding an agent without updating help can't pass unnoticed.
  it('lists every agent and its alias in --help', async () => {
    const { exitCode, stdout } = await runCli('--help');

    expect(exitCode).toBe(0);
    for (const target of SKILL_TARGETS) {
      expect(stdout).toContain(target);
    }
    expect(stdout).toContain('(alias: agy)');
  });

  it('rejects an unknown agent with the valid-agents list and exits non-zero', async () => {
    const { exitCode, stderr } = await runCli('update-skill', 'bogus');

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown agent: bogus');
    expect(stderr).toContain(SKILL_TARGETS.join(', '));
    expect(stderr).toContain('aliases: agy');
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
      expect(stderr).toContain('The hosted skill may not be published yet.');
      expect(existsSync(path.join(cwd, '.claude', 'skills', 'mochi', 'SKILL.md'))).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe('mochi-framework generate-key (subprocess)', () => {
  it('writes a 32-byte MOCHI_KEY to .env in the current directory', async () => {
    const cwd = freshCwd();
    const proc = Bun.spawn([process.execPath, CLI, 'generate-key'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    const env = await Bun.file(path.join(cwd, '.env')).text();
    const key = env.match(/^MOCHI_KEY=(.+)$/m)?.[1];
    expect(key).toBeDefined();
    expect(Buffer.from(key!, 'base64url').length).toBe(32);
  });

  it('replaces an existing MOCHI_KEY without prompting when --force is passed', async () => {
    const cwd = freshCwd();
    await Bun.write(path.join(cwd, '.env'), 'MOCHI_KEY=old\n');
    const proc = Bun.spawn([process.execPath, CLI, 'generate-key', '--force'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    const env = await Bun.file(path.join(cwd, '.env')).text();
    expect(env).not.toContain('MOCHI_KEY=old');
    const key = env.match(/^MOCHI_KEY=(.+)$/m)?.[1];
    expect(key).toBeDefined();
    expect(Buffer.from(key!, 'base64url').length).toBe(32);
  });

  it('lists generate-key in --help', async () => {
    const { exitCode, stdout } = await runCli('--help');

    expect(exitCode).toBe(0);
    expect(stdout).toContain('generate-key');
  });
});
