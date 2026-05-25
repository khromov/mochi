#!/usr/bin/env bun
/**
 * Renders the markdown body for the review-bot PR comment by diffing two
 * loc-report.ts JSON outputs.
 * Usage: bun loc-comment.ts <main.json> <pr.json> [--repo <owner/repo> --run-id <id>]
 */

import { readFileSync } from 'node:fs';

type Counts = { files: number; lines: number };
type Report = { name: string; totals: Counts; byCategory: Record<string, Counts> };
type Doc = { packages: Report[] };

const MARKER = '<!-- mochi-review-bot -->';

function delta(n: number): string {
  if (n === 0) {
    return '0';
  }
  return n > 0 ? `+${n}` : `${n}`;
}

function renderRow(name: string, mainLines: number, prLines: number, bold = false): string {
  const wrap = (s: string | number) => (bold ? `**${s}**` : `${s}`);
  return `| ${wrap(name)} | ${wrap(mainLines)} | ${wrap(prLines)} | ${wrap(delta(prLines - mainLines))} |`;
}

function renderPackageSection(name: string, mainReport: Report | undefined, prReport: Report | undefined): string[] {
  const main = mainReport?.byCategory ?? {};
  const pr = prReport?.byCategory ?? {};
  const allCategories = new Set([...Object.keys(main), ...Object.keys(pr)]);

  const changedRows: string[] = [];
  const unchanged: { name: string; lines: number }[] = [];
  for (const category of allCategories) {
    const mainLines = main[category]?.lines ?? 0;
    const prLines = pr[category]?.lines ?? 0;
    if (mainLines === 0 && prLines === 0) {
      continue;
    }
    if (prLines - mainLines === 0) {
      unchanged.push({ name: category, lines: prLines });
      continue;
    }
    changedRows.push(renderRow(`\`${category}\``, mainLines, prLines));
  }
  changedRows.push(renderRow('Total', mainReport?.totals.lines ?? 0, prReport?.totals.lines ?? 0, true));

  const lines: string[] = [`#### ${name}`, '', '| Category | main | PR | Δ |', '|---|---:|---:|---:|', ...changedRows];
  if (unchanged.length > 0) {
    lines.push('');
    lines.push(`_Unchanged: ${unchanged.map((c) => `\`${c.name}\` (${c.lines})`).join(', ')}._`);
  }
  return lines;
}

function renderInstallSection(repo: string, runId: string): string[] {
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  return [
    '---',
    '<details>',
    '<summary>Try this PR</summary>',
    '',
    '```sh',
    `gh run download -R ${repo} ${runId} -n mochi-framework-pr -D /tmp/mochi-pr && bun i /tmp/mochi-pr/mochi-framework-pr.tgz`,
    '```',
    '',
    `<sub><a href="${runUrl}#artifacts">Download manually</a></sub>`,
    '',
    '</details>',
  ];
}

function main() {
  const args = process.argv.slice(2);
  const mainPath = args[0];
  const prPath = args[1];
  const repoIdx = args.indexOf('--repo');
  const repo = repoIdx !== -1 ? args[repoIdx + 1] : undefined;
  const runIdIdx = args.indexOf('--run-id');
  const runId = runIdIdx !== -1 ? args[runIdIdx + 1] : undefined;

  if (!mainPath || !prPath) {
    console.error('Usage: bun loc-comment.ts <main.json> <pr.json> [--repo <owner/repo> --run-id <id>]');
    process.exit(1);
  }

  const mainDoc = JSON.parse(readFileSync(mainPath, 'utf8')) as Doc;
  const prDoc = JSON.parse(readFileSync(prPath, 'utf8')) as Doc;

  const allPackages = new Set([...mainDoc.packages.map((p) => p.name), ...prDoc.packages.map((p) => p.name)]);

  const lines: string[] = [MARKER, '### Mochi review report', '', '**Lines of code** (non-blank lines)', ''];
  for (const pkgName of allPackages) {
    const m = mainDoc.packages.find((p) => p.name === pkgName);
    const p = prDoc.packages.find((pp) => pp.name === pkgName);
    lines.push(...renderPackageSection(pkgName, m, p));
    lines.push('');
  }

  if (repo && runId) {
    lines.push(...renderInstallSection(repo, runId));
    lines.push('');
  }

  console.log(lines.join('\n').trimEnd());
}

main();
