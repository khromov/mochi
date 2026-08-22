#!/usr/bin/env bun
/**
 * Renders the markdown body for the review-bot PR comment by diffing two
 * loc-report.ts JSON outputs.
 * Usage: bun loc-comment.ts <main.json> <pr.json> [--repo <owner/repo> --run-id <id> --dep-report <dep-report.txt> --audit <audit.txt> --licenses <licenses.txt>]
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

function renderPackageSection(name: string, mainReport: Report | undefined, prReport: Report | undefined, openByDefault: boolean): string[] {
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

  const table = ['| Category | main | PR | Δ |', '|---|---:|---:|---:|', ...changedRows];
  if (unchanged.length > 0) {
    table.push('');
    table.push(`_Unchanged: ${unchanged.map((c) => `\`${c.name}\` (${c.lines})`).join(', ')}._`);
  }

  const detailsTag = openByDefault ? '<details open>' : '<details>';
  return [detailsTag, `<summary><strong>${name}</strong></summary>`, '', ...table, '', '</details>'];
}

// packages/minimal is the create-mochi template source and packages/demos ships
// standalone demos — both run against the *published* framework, so a reviewer
// must confirm no unreleased features slipped in.
function templatePackagesTouched(paths: string[]): boolean {
  return paths.some((p) => p.startsWith('packages/minimal/') || p.startsWith('packages/demos/'));
}

function renderDepReportSection(content: string): string[] {
  return ['### Dependency report', '', '<details>', '<summary>Expand report</summary>', '', '```', content.trimEnd(), '```', '', '</details>'];
}

// CLIs may still emit color when run under CI; strip it so the code block reads cleanly.
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

/** `bun audit` and `bun pm licenses --prod`, folded into one collapsible section. Advisory only — the PR never goes
 * red for a vulnerability it did not introduce; a reviewer reads this and runs `bun audit fix` deliberately. */
function renderAdvisorySection(audit?: string, licenses?: string): string[] {
  const out: string[] = ['### Security & licenses', ''];
  if (audit !== undefined) {
    out.push('<details>', '<summary><code>bun audit</code></summary>', '', '```', stripAnsi(audit).trimEnd() || '(no output)', '```', '', '</details>');
  }
  if (licenses !== undefined) {
    out.push('<details>', '<summary><code>bun pm licenses --prod</code></summary>', '', '```', stripAnsi(licenses).trimEnd() || '(no output)', '```', '', '</details>');
  }
  return out;
}

function renderInstallSection(repo: string, runId: string): string[] {
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  return [
    '### Try this PR',
    '',
    '<details>',
    '<summary>Expand instructions</summary>',
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
  const depIdx = args.indexOf('--dep-report');
  const depReportPath = depIdx !== -1 ? args[depIdx + 1] : undefined;
  const changedIdx = args.indexOf('--changed-paths');
  const changedPathsPath = changedIdx !== -1 ? args[changedIdx + 1] : undefined;
  const auditIdx = args.indexOf('--audit');
  const auditPath = auditIdx !== -1 ? args[auditIdx + 1] : undefined;
  const licensesIdx = args.indexOf('--licenses');
  const licensesPath = licensesIdx !== -1 ? args[licensesIdx + 1] : undefined;

  if (!mainPath || !prPath) {
    console.error('Usage: bun loc-comment.ts <main.json> <pr.json> [--repo <owner/repo> --run-id <id>]');
    process.exit(1);
  }

  const mainDoc = JSON.parse(readFileSync(mainPath, 'utf8')) as Doc;
  const prDoc = JSON.parse(readFileSync(prPath, 'utf8')) as Doc;

  const allPackages = new Set([...mainDoc.packages.map((p) => p.name), ...prDoc.packages.map((p) => p.name)]);

  const lines: string[] = [MARKER, '## Mochi review report', ''];

  if (changedPathsPath) {
    try {
      const changed = readFileSync(changedPathsPath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (templatePackagesTouched(changed)) {
        lines.push('> ⚠️ This PR modified the starter templates. Make sure no unreleased features are used in the template.', '');
      }
    } catch {
      // changed-paths is optional — skip if the file is missing or unreadable
    }
  }

  if (repo && runId) {
    lines.push(...renderInstallSection(repo, runId));
    lines.push('');
  }

  if (depReportPath) {
    try {
      const depContent = readFileSync(depReportPath, 'utf8');
      lines.push(...renderDepReportSection(depContent));
      lines.push('');
    } catch {
      // dep-report is optional — skip if the file is missing or unreadable
    }
  }

  // Each file is optional — read what exists, render the section only if either is present.
  const readOptional = (path: string | undefined): string | undefined => {
    if (!path) {
      return undefined;
    }
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  };
  const auditContent = readOptional(auditPath);
  const licensesContent = readOptional(licensesPath);
  if (auditContent !== undefined || licensesContent !== undefined) {
    lines.push(...renderAdvisorySection(auditContent, licensesContent));
    lines.push('');
  }

  lines.push('### Lines of code', '');
  for (const pkgName of allPackages) {
    const m = mainDoc.packages.find((p) => p.name === pkgName);
    const p = prDoc.packages.find((pp) => pp.name === pkgName);
    lines.push(...renderPackageSection(pkgName, m, p, pkgName === 'packages/mochi'));
    lines.push('');
  }

  console.log(lines.join('\n').trimEnd());
}

main();
