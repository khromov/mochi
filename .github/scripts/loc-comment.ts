#!/usr/bin/env bun
/**
 * Renders the markdown body for the review-bot PR comment by diffing two
 * loc-report.ts JSON outputs.
 * Usage: bun loc-comment.ts <main.json> <pr.json> [--repo <owner/repo> --run-id <id> --dep-report <dep-report.txt>]
 */

import { readFileSync } from 'node:fs';

type Counts = { files: number; lines: number };
type Report = { name: string; totals: Counts; byCategory: Record<string, Counts> };
type Doc = { packages: Report[] };

const MARKER = '<!-- mochi-review-bot -->';
// Must match loc-report.ts's catch-all bucket.
const MISCELLANEOUS = 'Other';

function delta(n: number): string {
  if (n === 0) {
    return '0';
  }
  return n > 0 ? `+${n}` : `${n}`;
}

function renderRow(name: string, mainLines: number, prLines: number, bold = false, deltaText?: string): string {
  const wrap = (s: string | number) => (bold ? `**${s}**` : `${s}`);
  return `| ${wrap(name)} | ${wrap(mainLines)} | ${wrap(prLines)} | ${wrap(deltaText ?? delta(prLines - mainLines))} |`;
}

function renderPackageSection(name: string, mainReport: Report | undefined, prReport: Report | undefined, openByDefault: boolean): string[] {
  const main = mainReport?.byCategory ?? {};
  const pr = prReport?.byCategory ?? {};
  const allCategories = new Set([...Object.keys(main), ...Object.keys(pr)]);

  const changed: { name: string; mainLines: number; prLines: number; oneSided: boolean }[] = [];
  const unchanged: { name: string; lines: number }[] = [];
  for (const category of allCategories) {
    const mainLines = main[category]?.lines ?? 0;
    const prLines = pr[category]?.lines ?? 0;
    if (mainLines === 0 && prLines === 0) {
      continue;
    }
    // main.json comes from main's own copy of loc-report.ts, which seeds every
    // one of its patterns to zero. A key on only one side therefore means the
    // pattern list changed, not the code — the lines moved in or out of
    // "Other" rather than being written or deleted, so a ±N here would lie.
    const oneSided = !(category in main) || !(category in pr);
    if (!oneSided && prLines === mainLines) {
      unchanged.push({ name: category, lines: prLines });
      continue;
    }
    changed.push({ name: category, mainLines, prLines, oneSided });
  }

  // Every reclassified line came out of (or fell into) Other, so its delta is
  // an artifact of the same pattern-list change rather than real churn.
  const reclassified = changed.some((c) => c.oneSided);
  const changedRows = changed.map((c) =>
    renderRow(
      `\`${c.name}\``,
      c.mainLines,
      c.prLines,
      false,
      c.oneSided ? (c.name in main ? 'dropped †' : 'new †') : reclassified && c.name === MISCELLANEOUS ? `${delta(c.prLines - c.mainLines)} †` : undefined,
    ),
  );
  changedRows.push(renderRow('Total', mainReport?.totals.lines ?? 0, prReport?.totals.lines ?? 0, true));

  const table = ['| Category | main | PR | Δ |', '|---|---:|---:|---:|', ...changedRows];
  if (reclassified) {
    table.push('');
    table.push('_† This PR changed the loc-report category list, so these lines were reclassified from/into `Other` rather than written or deleted. Compare the **Total** row._');
  }
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
