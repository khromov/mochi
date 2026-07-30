#!/usr/bin/env bun
/**
 * Regression test for `bun create mochi@latest`. For each published template
 * (`minimal`, `demos`) it scaffolds into
 * ./cli-tests/mochi-test-<id>-<template>/, runs `bun install`, `bun run test`,
 * and `bun run typecheck`, then writes a single combined Markdown report with
 * one section per template. Scaffold dirs are always kept for inspection.
 * Exits non-zero if any template fails any step.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TESTS_DIR = join(REPO_ROOT, 'cli-tests');

// Kept in sync with packages/cli/src/templates.ts (not imported — this script
// stays dependency-free of the workspace packages).
const TEMPLATES = ['minimal', 'demos'] as const;
type TemplateId = (typeof TEMPLATES)[number];

type StepName = 'scaffold' | 'install' | 'test' | 'typecheck';
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

async function runCmd(cmd: string[], cwd: string): Promise<RunResult> {
  const start = performance.now();
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
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

async function probeCliVersion(): Promise<string> {
  const r = await runCmd(['bunx', '--bun', 'create-mochi@latest', '--version'], REPO_ROOT);
  if (r.exitCode !== 0) {
    return 'unknown';
  }
  return r.stdout.trim().split('\n').pop()?.trim() || 'unknown';
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
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

function extractInstalledMochiVersion(scaffoldDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(scaffoldDir, 'node_modules', 'mochi-framework', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

interface TemplateResult {
  template: TemplateId;
  scaffoldDirRel: string;
  mochiVersion: string;
  mochiInstalledVersion: string;
  steps: StepResult[];
  overall: Status;
}

function renderTemplateSection(r: TemplateResult, cliVersion: string): string[] {
  const overallLabel = r.overall === 'pass' ? '✅ pass' : '❌ fail';
  const lines: string[] = [];
  lines.push(`## Template: ${r.template} — ${overallLabel}`);
  lines.push('');
  lines.push(`- **Scaffold dir:** \`${r.scaffoldDirRel}\``);
  lines.push(`- create-mochi (CLI): ${cliVersion}`);
  lines.push(`- mochi-framework (pinned by scaffold): ${r.mochiVersion}`);
  lines.push(`- mochi-framework (installed): ${r.mochiInstalledVersion}`);
  lines.push('');
  lines.push('| Step       | Status     | Duration | Exit |');
  lines.push('|------------|------------|----------|------|');
  for (const s of r.steps) {
    const exit = s.exitCode === null ? '—' : String(s.exitCode);
    lines.push(`| ${s.name.padEnd(10)} | ${statusCell(s.status).padEnd(10)} | ${fmtDuration(s.durationMs).padStart(8)} | ${exit.padStart(4)} |`);
  }

  const failures = r.steps.filter((s) => s.status === 'fail');
  if (failures.length > 0) {
    lines.push('');
    lines.push('### Failures');
    for (const s of failures) {
      lines.push('');
      lines.push(`#### ${s.name}`);
      lines.push('');
      lines.push('```');
      lines.push(s.output || '(no output captured)');
      lines.push('```');
    }
  }
  return lines;
}

function renderReport(args: {
  id: string;
  when: string;
  overall: Status;
  cliVersion: string;
  bunVersion: string;
  nodeVersion: string;
  platform: string;
  results: TemplateResult[];
}): string {
  const overallLabel = args.overall === 'pass' ? '✅ pass' : '❌ fail';
  const lines: string[] = [];
  lines.push(`# Mochi CLI regression — mochi-test-${args.id}`);
  lines.push('');
  lines.push(`- **When:** ${args.when}`);
  lines.push(`- **Result:** ${overallLabel}`);
  lines.push(`- **Templates:** ${args.results.map((r) => r.template).join(', ')}`);
  lines.push('');
  lines.push('## Environment');
  lines.push(`- create-mochi (CLI): ${args.cliVersion}`);
  lines.push(`- Bun: ${args.bunVersion}`);
  lines.push(`- Node API: ${args.nodeVersion}`);
  lines.push(`- Platform: ${args.platform}`);
  lines.push('');
  for (const r of args.results) {
    lines.push(...renderTemplateSection(r, args.cliVersion));
    lines.push('');
  }
  return lines.join('\n');
}

async function runTemplate(template: TemplateId, id: string): Promise<TemplateResult> {
  const name = `mochi-test-${id}-${template}`;
  const scaffoldDir = join(TESTS_DIR, name);
  const scaffoldDirRel = `./cli-tests/${name}`;

  console.log('');
  console.log(`▶ ${template} (${scaffoldDirRel})`);

  const steps: Record<StepName, StepResult> = {
    scaffold: skipped('scaffold'),
    install: skipped('install'),
    test: skipped('test'),
    typecheck: skipped('typecheck'),
  };

  console.log(`  [${template}] • scaffold…`);
  const scaffold = await runCmd(['bun', 'create', 'mochi@latest', scaffoldDirRel, '--template', template, '--force'], REPO_ROOT);
  steps.scaffold = toStep('scaffold', scaffold);
  console.log(`  [${template}]   ${statusCell(steps.scaffold.status)} (${fmtDuration(steps.scaffold.durationMs)})`);

  let mochiVersion = 'unknown';
  let mochiInstalledVersion = 'unknown';

  if (steps.scaffold.status === 'pass') {
    mochiVersion = extractMochiVersion(scaffold.stdout, scaffoldDir);

    console.log(`  [${template}] • install…`);
    const install = await runCmd(['bun', 'install'], scaffoldDir);
    steps.install = toStep('install', install);
    console.log(`  [${template}]   ${statusCell(steps.install.status)} (${fmtDuration(steps.install.durationMs)})`);

    if (steps.install.status === 'pass') {
      mochiInstalledVersion = extractInstalledMochiVersion(scaffoldDir);

      console.log(`  [${template}] • test…`);
      const test = await runCmd(['bun', 'run', 'test'], scaffoldDir);
      steps.test = toStep('test', test);
      console.log(`  [${template}]   ${statusCell(steps.test.status)} (${fmtDuration(steps.test.durationMs)})`);

      console.log(`  [${template}] • typecheck…`);
      const tc = await runCmd(['bun', 'run', 'typecheck'], scaffoldDir);
      steps.typecheck = toStep('typecheck', tc);
      console.log(`  [${template}]   ${statusCell(steps.typecheck.status)} (${fmtDuration(steps.typecheck.durationMs)})`);
    }
  }

  const ordered: StepResult[] = [steps.scaffold, steps.install, steps.test, steps.typecheck];
  const overall: Status = ordered.every((s) => s.status === 'pass') ? 'pass' : 'fail';

  return { template, scaffoldDirRel, mochiVersion, mochiInstalledVersion, steps: ordered, overall };
}

async function main() {
  const id = String(Math.floor(Date.now() / 1000));
  const reportPath = join(TESTS_DIR, `mochi-test-${id}-report.md`);
  const when = new Date().toISOString();

  mkdirSync(TESTS_DIR, { recursive: true });

  console.log(`▶ mochi-test-${id}`);
  console.log(`  templates: ${TEMPLATES.join(', ')}`);
  console.log(`  report:    ./cli-tests/mochi-test-${id}-report.md`);

  const cliVersion = await probeCliVersion();
  console.log(`  create-mochi: ${cliVersion}`);

  const results: TemplateResult[] = [];
  for (const template of TEMPLATES) {
    results.push(await runTemplate(template, id));
  }

  const overall: Status = results.every((r) => r.overall === 'pass') ? 'pass' : 'fail';

  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : 'unknown';
  const nodeVersion = process.versions.node ? `v${process.versions.node}` : 'unknown';
  const platform = `${os.platform()} ${os.arch()}`;

  const report = renderReport({
    id,
    when,
    overall,
    cliVersion,
    bunVersion,
    nodeVersion,
    platform,
    results,
  });

  writeFileSync(reportPath, report);

  console.log('');
  for (const r of results) {
    console.log(`  ${r.template}: ${r.overall === 'pass' ? '✅ pass' : '❌ fail'}`);
  }
  console.log(`overall: ${overall === 'pass' ? '✅ pass' : '❌ fail'}`);
  console.log(`report:  ${resolve(reportPath)}`);

  process.exit(overall === 'pass' ? 0 : 1);
}

main();
