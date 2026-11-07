#!/usr/bin/env bun
/**
 * Daily "does Mochi still work with the newest Svelte" regression. Scaffolds a
 * fresh `minimal` project with `bun create mochi@latest`, force-upgrades Svelte
 * to the latest published release (`bun add svelte@latest` — unconstrained by
 * the template's `^5` range, so it picks up Svelte 6+ the day it ships), builds
 * it, then boots the built app and curls a route. Writes a Markdown report and
 * exits non-zero if any step fails. The scaffold dir is kept for inspection.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TESTS_DIR = join(REPO_ROOT, 'svelte-latest-tests');
const SMOKE_PORT = 4321;
const SMOKE_MARKER = 'Hello Mochi!';
const SMOKE_TIMEOUT_MS = 30_000;

type StepName = 'scaffold' | 'install' | 'upgrade-svelte' | 'build' | 'smoke';
type Status = 'pass' | 'fail' | 'skipped';

interface StepResult {
  name: StepName;
  status: Status;
  durationMs: number | null;
  exitCode: number | null;
  output: string; // combined stdout+stderr, only populated on failure
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function runCmd(cmd: string[], cwd: string, env?: Record<string, string>): Promise<RunResult> {
  const start = performance.now();
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: env ? { ...process.env, ...env } : undefined });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return {
    exitCode: proc.exitCode ?? -1,
    stdout,
    stderr,
    durationMs: performance.now() - start,
  };
}

function tail(text: string, lines = 40): string {
  const all = text.split('\n');
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

function fmtDuration(ms: number | null): string {
  if (ms === null) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusCell(status: Status): string {
  if (status === 'pass') {
    return '✅ pass';
  }
  if (status === 'fail') {
    return '❌ fail';
  }
  return '⏭ skipped';
}

function skipped(name: StepName): StepResult {
  return { name, status: 'skipped', durationMs: null, exitCode: null, output: '' };
}

function toStep(name: StepName, r: RunResult): StepResult {
  const ok = r.exitCode === 0;
  return {
    name,
    status: ok ? 'pass' : 'fail',
    durationMs: r.durationMs,
    exitCode: r.exitCode,
    output: ok ? '' : tail(`${r.stdout}\n${r.stderr}`),
  };
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

async function probeCliVersion(): Promise<string> {
  const r = await runCmd(['bun', 'info', 'create-mochi', 'version'], REPO_ROOT);
  if (r.exitCode !== 0) {
    return 'unknown';
  }
  return r.stdout.trim().split('\n').pop()?.trim() || 'unknown';
}

function extractMochiVersion(scaffoldStdout: string, scaffoldDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(scaffoldDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const v = pkg.dependencies?.['mochi-framework'];
    if (v) {
      return v;
    }
  } catch {
    /* fall through to stdout scrape */
  }
  const m = stripAnsi(scaffoldStdout).match(/pinned to (\S+)/);
  return m ? m[1]! : 'unknown';
}

function extractInstalledVersion(scaffoldDir: string, dep: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(scaffoldDir, 'node_modules', dep, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function majorOf(version: string): string {
  const m = version.match(/^(\d+)\./);
  return m ? m[1]! : '?';
}

/** Boots the built app in production mode, polls a route until it renders, and asserts the marker. */
async function smokeTest(scaffoldDir: string): Promise<RunResult> {
  const start = performance.now();
  // Spawn the server entry directly, not `bun run start` — the wrapper forks
  // `bun src/index.ts` and proc.kill() would only reach the wrapper, orphaning
  // the real server holding the port.
  const proc = Bun.spawn(['bun', 'src/index.ts'], {
    cwd: scaffoldDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PORT: String(SMOKE_PORT), NODE_ENV: 'production' },
  });

  // Drain the pipes concurrently so a chatty server can't fill the OS buffer,
  // block on write mid-response, and stall the poll; both resolve after kill.
  const stdoutP = new Response(proc.stdout).text();
  const stderrP = new Response(proc.stderr).text();

  const url = `http://localhost:${SMOKE_PORT}/`;
  const deadline = performance.now() + SMOKE_TIMEOUT_MS;
  let lastErr = '';
  let body = '';
  let status = 0;

  try {
    while (performance.now() < deadline) {
      if (proc.exitCode !== null) {
        lastErr = 'server process exited before serving';
        break;
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        status = res.status;
        body = await res.text();
        if (status === 200) {
          break;
        }
        lastErr = `HTTP ${status}`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      await Bun.sleep(500);
    }
  } finally {
    proc.kill();
    await proc.exited;
  }

  const ok = status === 200 && body.includes(SMOKE_MARKER);
  const serverLog = `${await stdoutP}\n${await stderrP}`;
  const summary = ok
    ? `smoke OK — GET ${url} → 200, body contains ${JSON.stringify(SMOKE_MARKER)}`
    : `smoke FAILED — GET ${url} → status=${status}, marker=${body.includes(SMOKE_MARKER)}, lastError=${lastErr}\n\n--- server log ---\n${tail(serverLog)}`;

  return {
    exitCode: ok ? 0 : 1,
    stdout: summary,
    stderr: '',
    durationMs: performance.now() - start,
  };
}

interface Report {
  id: string;
  when: string;
  overall: Status;
  cliVersion: string;
  mochiVersion: string;
  mochiInstalledVersion: string;
  svelteVersion: string;
  scaffoldDirRel: string;
  bunVersion: string;
  platform: string;
  steps: StepResult[];
}

function renderReport(r: Report): string {
  const overallLabel = r.overall === 'pass' ? '✅ pass' : '❌ fail';
  const lines: string[] = [];
  lines.push(`# Mochi × latest Svelte — svelte-latest-${r.id}`);
  lines.push('');
  lines.push(`- **When:** ${r.when}`);
  lines.push(`- **Result:** ${overallLabel}`);
  lines.push(`- **Svelte tested:** ${r.svelteVersion} (major ${majorOf(r.svelteVersion)})`);
  lines.push('');
  lines.push('## Environment');
  lines.push(`- **Scaffold dir:** \`${r.scaffoldDirRel}\``);
  lines.push(`- create-mochi (CLI): ${r.cliVersion}`);
  lines.push(`- mochi-framework (pinned by scaffold): ${r.mochiVersion}`);
  lines.push(`- mochi-framework (installed): ${r.mochiInstalledVersion}`);
  lines.push(`- svelte (installed after upgrade): ${r.svelteVersion}`);
  lines.push(`- Bun: ${r.bunVersion}`);
  lines.push(`- Platform: ${r.platform}`);
  lines.push('');
  lines.push('| Step           | Status     | Duration | Exit |');
  lines.push('|----------------|------------|----------|------|');
  for (const s of r.steps) {
    const exit = s.exitCode === null ? '—' : String(s.exitCode);
    lines.push(`| ${s.name.padEnd(14)} | ${statusCell(s.status).padEnd(10)} | ${fmtDuration(s.durationMs).padStart(8)} | ${exit.padStart(4)} |`);
  }

  const failures = r.steps.filter((s) => s.status === 'fail');
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    for (const s of failures) {
      lines.push('');
      lines.push(`### ${s.name}`);
      lines.push('');
      lines.push('```');
      lines.push(s.output || '(no output captured)');
      lines.push('```');
    }
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const id = String(Math.floor(Date.now() / 1000));
  const name = `mochi-svelte-latest-${id}`;
  const scaffoldDir = join(TESTS_DIR, name);
  const scaffoldDirRel = `./svelte-latest-tests/${name}`;
  const reportPath = join(TESTS_DIR, `${name}-report.md`);
  const when = new Date().toISOString();

  mkdirSync(TESTS_DIR, { recursive: true });

  console.log(`▶ ${name}`);
  console.log(`  scaffold: ${scaffoldDirRel}`);
  console.log(`  report:   ./svelte-latest-tests/${name}-report.md`);

  const cliVersion = await probeCliVersion();
  console.log(`  create-mochi: ${cliVersion}`);

  const steps: Record<StepName, StepResult> = {
    scaffold: skipped('scaffold'),
    install: skipped('install'),
    'upgrade-svelte': skipped('upgrade-svelte'),
    build: skipped('build'),
    smoke: skipped('smoke'),
  };

  let mochiVersion = 'unknown';
  let mochiInstalledVersion = 'unknown';
  let svelteVersion = 'unknown';

  console.log('  • scaffold…');
  const scaffold = await runCmd(['bun', 'create', 'mochi@latest', scaffoldDirRel, '--template', 'minimal', '--force'], REPO_ROOT);
  steps.scaffold = toStep('scaffold', scaffold);
  console.log(`    ${statusCell(steps.scaffold.status)} (${fmtDuration(steps.scaffold.durationMs)})`);

  if (steps.scaffold.status === 'pass') {
    mochiVersion = extractMochiVersion(scaffold.stdout, scaffoldDir);

    console.log('  • install…');
    steps.install = toStep('install', await runCmd(['bun', 'install'], scaffoldDir));
    console.log(`    ${statusCell(steps.install.status)} (${fmtDuration(steps.install.durationMs)})`);

    if (steps.install.status === 'pass') {
      mochiInstalledVersion = extractInstalledVersion(scaffoldDir, 'mochi-framework');

      console.log('  • upgrade-svelte (bun add svelte@latest)…');
      steps['upgrade-svelte'] = toStep('upgrade-svelte', await runCmd(['bun', 'add', 'svelte@latest'], scaffoldDir));
      svelteVersion = extractInstalledVersion(scaffoldDir, 'svelte');
      console.log(`    ${statusCell(steps['upgrade-svelte'].status)} (${fmtDuration(steps['upgrade-svelte'].durationMs)}) — svelte ${svelteVersion}`);

      if (steps['upgrade-svelte'].status === 'pass') {
        console.log('  • build…');
        steps.build = toStep('build', await runCmd(['bun', 'run', 'build'], scaffoldDir));
        console.log(`    ${statusCell(steps.build.status)} (${fmtDuration(steps.build.durationMs)})`);

        if (steps.build.status === 'pass') {
          console.log('  • smoke…');
          steps.smoke = toStep('smoke', await smokeTest(scaffoldDir));
          console.log(`    ${statusCell(steps.smoke.status)} (${fmtDuration(steps.smoke.durationMs)})`);
        }
      }
    }
  }

  const ordered: StepResult[] = [steps.scaffold, steps.install, steps['upgrade-svelte'], steps.build, steps.smoke];
  const overall: Status = ordered.every((s) => s.status === 'pass') ? 'pass' : 'fail';

  const report = renderReport({
    id,
    when,
    overall,
    cliVersion,
    mochiVersion,
    mochiInstalledVersion,
    svelteVersion,
    scaffoldDirRel,
    bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
    platform: `${os.platform()} ${os.arch()}`,
    steps: ordered,
  });

  writeFileSync(reportPath, report);

  console.log('');
  console.log(`svelte:  ${svelteVersion} (major ${majorOf(svelteVersion)})`);
  console.log(`overall: ${overall === 'pass' ? '✅ pass' : '❌ fail'}`);
  console.log(`report:  ${resolve(reportPath)}`);

  process.exit(overall === 'pass' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
