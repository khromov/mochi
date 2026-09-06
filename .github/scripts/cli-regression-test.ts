#!/usr/bin/env bun
/**
 * Regression test for `bun create mochi@latest`. For each published template
 * (`minimal`, `demos`) it scaffolds into
 * ./cli-tests/mochi-test-<id>-<template>/, runs `bun install`, `bun run test`,
 * `bun run typecheck`, and — when the scaffold ships them — `bun run lint` and
 * `bun run format:check`, then writes a single combined Markdown report with
 * one section per template. CLI versions that add lint tooling (>=0.4.0) also
 * get a `--no-eslint --no-prettier` scaffold checked for clean omission.
 * Scaffold dirs are always kept for inspection.
 * Exits non-zero if any template fails any step.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const TESTS_DIR = join(REPO_ROOT, 'cli-tests');

// Kept in sync with packages/cli/src/templates.ts (not imported — this script
// stays dependency-free of the workspace packages).
const TEMPLATES = ['minimal', 'demos'] as const;
type TemplateId = (typeof TEMPLATES)[number];

type StepName = 'scaffold' | 'install' | 'test' | 'typecheck' | 'lint' | 'format' | 'omissions';
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

function readScaffoldScripts(scaffoldDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(scaffoldDir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/** Pass when nothing failed and every required step ran — optional steps (lint/format on pre-0.4.0 CLIs) may stay skipped. */
function templateOverall(all: StepResult[], required: StepResult[]): Status {
  return all.every((s) => s.status !== 'fail') && required.every((s) => s.status === 'pass') ? 'pass' : 'fail';
}

interface TemplateResult {
  template: string;
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

interface TemplateVariant {
  /** Scaffold-dir suffix, e.g. '-no-lint'. */
  suffix: string;
  /** Extra flags passed to `bun create mochi@latest`. */
  extraArgs: string[];
  /** Assert the scaffold shipped no lint tooling (config files or scripts). */
  expectNoLintTooling: boolean;
}

type TemplateSteps = Record<'scaffold' | 'install' | 'test' | 'typecheck' | 'lint' | 'format' | 'omissions', StepResult>;

// Assert an opt-out scaffold shipped no lint/format config files or scripts.
function checkLintOmissions(scaffoldDir: string, label: string): StepResult {
  const scripts = readScaffoldScripts(scaffoldDir);
  const leftovers = [
    ...['eslint.config.js', '.prettierrc', '.prettierignore'].filter((f) => existsSync(join(scaffoldDir, f))),
    ...['lint', 'lint:fix', 'format', 'format:check'].filter((s) => scripts[s]).map((s) => `scripts.${s}`),
  ];
  const step: StepResult = {
    name: 'omissions',
    status: leftovers.length === 0 ? 'pass' : 'fail',
    durationMs: null,
    exitCode: null,
    output: leftovers.length === 0 ? '' : `lint tooling present despite opt-out flags: ${leftovers.join(', ')}`,
  };
  console.log(`  [${label}]   omissions ${statusCell(step.status)}`);
  return step;
}

async function runVerificationSteps(scaffoldDir: string, label: string, steps: TemplateSteps): Promise<void> {
  console.log(`  [${label}] • test…`);
  steps.test = toStep('test', await runCmd(['bun', 'run', 'test'], scaffoldDir));
  console.log(`  [${label}]   ${statusCell(steps.test.status)} (${fmtDuration(steps.test.durationMs)})`);

  console.log(`  [${label}] • typecheck…`);
  steps.typecheck = toStep('typecheck', await runCmd(['bun', 'run', 'typecheck'], scaffoldDir));
  console.log(`  [${label}]   ${statusCell(steps.typecheck.status)} (${fmtDuration(steps.typecheck.durationMs)})`);

  // Lint tooling ships with create-mochi >=0.4.0 — older published CLIs scaffold without it, so these stay skipped.
  const scripts = readScaffoldScripts(scaffoldDir);
  if (scripts.lint) {
    console.log(`  [${label}] • lint…`);
    steps.lint = toStep('lint', await runCmd(['bun', 'run', 'lint'], scaffoldDir));
    console.log(`  [${label}]   ${statusCell(steps.lint.status)} (${fmtDuration(steps.lint.durationMs)})`);
  }
  if (scripts['format:check']) {
    console.log(`  [${label}] • format:check…`);
    steps.format = toStep('format', await runCmd(['bun', 'run', 'format:check'], scaffoldDir));
    console.log(`  [${label}]   ${statusCell(steps.format.status)} (${fmtDuration(steps.format.durationMs)})`);
  }
}

async function runTemplate(template: TemplateId, id: string, variant?: TemplateVariant): Promise<TemplateResult> {
  const name = `mochi-test-${id}-${template}${variant?.suffix ?? ''}`;
  const scaffoldDir = join(TESTS_DIR, name);
  const scaffoldDirRel = `./cli-tests/${name}`;
  const label = variant ? `${template} (${variant.extraArgs.join(' ')})` : template;

  console.log('');
  console.log(`▶ ${label} (${scaffoldDirRel})`);

  const steps = {
    scaffold: skipped('scaffold'),
    install: skipped('install'),
    test: skipped('test'),
    typecheck: skipped('typecheck'),
    lint: skipped('lint'),
    format: skipped('format'),
    omissions: skipped('omissions'),
  };

  console.log(`  [${label}] • scaffold…`);
  const scaffold = await runCmd(['bun', 'create', 'mochi@latest', scaffoldDirRel, '--template', template, '--force', ...(variant?.extraArgs ?? [])], REPO_ROOT);
  steps.scaffold = toStep('scaffold', scaffold);
  console.log(`  [${label}]   ${statusCell(steps.scaffold.status)} (${fmtDuration(steps.scaffold.durationMs)})`);

  let mochiVersion = 'unknown';
  let mochiInstalledVersion = 'unknown';

  if (steps.scaffold.status === 'pass') {
    mochiVersion = extractMochiVersion(scaffold.stdout, scaffoldDir);

    if (variant?.expectNoLintTooling) {
      steps.omissions = checkLintOmissions(scaffoldDir, label);
    }

    console.log(`  [${label}] • install…`);
    const install = await runCmd(['bun', 'install'], scaffoldDir);
    steps.install = toStep('install', install);
    console.log(`  [${label}]   ${statusCell(steps.install.status)} (${fmtDuration(steps.install.durationMs)})`);

    if (steps.install.status === 'pass') {
      mochiInstalledVersion = extractInstalledMochiVersion(scaffoldDir);
      await runVerificationSteps(scaffoldDir, label, steps);
    }
  }

  const core = [steps.scaffold, steps.install, steps.test, steps.typecheck];
  const required = variant?.expectNoLintTooling ? [...core, steps.omissions] : core;
  const ordered: StepResult[] = [steps.scaffold, steps.install, steps.test, steps.typecheck, steps.lint, steps.format, ...(variant?.expectNoLintTooling ? [steps.omissions] : [])];
  const overall: Status = templateOverall(ordered, required);

  return { template: label, scaffoldDirRel, mochiVersion, mochiInstalledVersion, steps: ordered, overall };
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

  // Older published CLIs reject the opt-out flags (commander exits 1 on unknown options).
  if (cliVersion !== 'unknown' && Bun.semver.satisfies(cliVersion, '>=0.4.0')) {
    results.push(await runTemplate('minimal', id, { suffix: '-no-lint', extraArgs: ['--no-eslint', '--no-prettier'], expectNoLintTooling: true }));
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
