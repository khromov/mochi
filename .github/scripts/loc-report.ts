#!/usr/bin/env bun
/**
 * Walks each monorepo package and classifies its files by the first matching
 * pattern. The matched pattern string is used as the row label. Default output
 * is a per-package human-readable table; pass --json for the machine-readable
 * { packages: [{ name, totals, byCategory }, ...] } shape used by the review
 * workflow's diff step.
 *
 * To add a new category, add a pattern to the package's `categories` list
 * below. The first matching pattern wins. Anything in the package's `src/`
 * that no pattern matches falls into "Other" so newly added files show up in
 * the report immediately.
 */

import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Package = {
  name: string;
  root: string;
  categories: string[];
  docsGlob?: string;
};

const REPO_ROOT = join(import.meta.dir, '..', '..');
const COUNTED_EXTENSIONS = ['ts', 'js', 'svelte', 'html'];
const SCAN_GLOB = `src/**/*.{${COUNTED_EXTENSIONS.join(',')}}`;
const MISCELLANEOUS = 'Other';
const DOCS_CATEGORY = 'Docs';

// Generated files would otherwise inflate the count and drift between local
// runs (where they exist) and CI runs (where they don't).
const EXCLUDE: string[] = ['src/**/*.generated.*'];

// First match wins within a package. Tests come first so test files don't
// bleed into other categories.
const PACKAGES: Package[] = [
  {
    name: 'packages/mochi',
    root: join(REPO_ROOT, 'packages', 'mochi'),
    categories: [
      'src/**/*.test.ts',
      'src/Mochi.ts',
      'src/ComponentRegistry.ts',
      'src/hooks.ts',
      'src/{requestContext,forms,errors}.ts',
      'src/{events,log,logger}.ts',
      'src/consoleLogger.ts',
      'src/cookies*.ts',
      'src/extensions.ts',
      'src/cache.ts',
      'src/middleware/**',
      'src/enhance*.ts',
      'src/build*.ts',
      'src/proxy.ts',
      'src/cli*',
      'src/{csrf,serverIslandCrypto}.ts',
      'src/{types.ts,*.d.ts}',
      'src/web-components/**',
      'src/debug-bar/**',
      'src/templates/**',
    ],
    docsGlob: 'docs/**/*.md',
  },
  {
    name: 'packages/site',
    root: join(REPO_ROOT, 'packages', 'site'),
    categories: ['src/demos/**', 'src/components/**', 'src/lib/**', 'src/stores/**'],
  },
  {
    name: 'packages/demos',
    root: join(REPO_ROOT, 'packages', 'demos'),
    categories: ['src/hn/**'],
  },
  {
    name: 'packages/minimal',
    root: join(REPO_ROOT, 'packages', 'minimal'),
    categories: [],
  },
  {
    name: 'packages/cli',
    root: join(REPO_ROOT, 'packages', 'cli'),
    categories: ['src/**/*.test.ts', 'src/cli*', 'src/{create,templates,utils}.ts'],
  },
];

type Counts = { files: number; lines: number };
type Report = { name: string; totals: Counts; byCategory: Record<string, Counts> };

function classify(relPath: string, categories: string[]): string {
  for (const pattern of categories) {
    if (new Glob(pattern).match(relPath)) {
      return pattern;
    }
  }
  return MISCELLANEOUS;
}

function countNonBlankLines(absPath: string): number {
  const text = readFileSync(absPath, 'utf8');
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) {
      n++;
    }
  }
  return n;
}

function renderSection(report: Report): string {
  const rows = Object.entries(report.byCategory)
    .filter(([, c]) => c.files > 0)
    .sort((a, b) => b[1].lines - a[1].lines);

  const nameWidth = Math.max('Category'.length, ...rows.map(([n]) => n.length));
  const linesWidth = Math.max('Lines'.length, String(report.totals.lines).length);
  const filesWidth = Math.max('Files'.length, String(report.totals.files).length);
  const barWidth = 24;
  const pctWidth = 6;
  const max = rows[0]?.[1].lines ?? 1;

  const fmt = (name: string, lines: string, files: string, bar: string, pct: string) =>
    `${name.padEnd(nameWidth)}  ${lines.padStart(linesWidth)}  ${files.padStart(filesWidth)}  ${bar.padEnd(barWidth)}  ${pct.padStart(pctWidth)}`;

  const out: string[] = [];
  out.push(`${report.name} — ${report.totals.lines} lines across ${report.totals.files} files`);
  out.push('');
  out.push(fmt('Category', 'Lines', 'Files', 'Share', '%'));
  const headerRowWidth = nameWidth + 2 + linesWidth + 2 + filesWidth + 2 + barWidth + 2 + pctWidth;
  out.push('─'.repeat(headerRowWidth));

  for (const [name, c] of rows) {
    const pct = report.totals.lines === 0 ? 0 : (c.lines / report.totals.lines) * 100;
    const filled = Math.round((c.lines / max) * barWidth);
    const bar = '█'.repeat(filled);
    out.push(fmt(name, String(c.lines), String(c.files), bar, `${pct.toFixed(1)}%`));
  }

  out.push('─'.repeat(headerRowWidth));
  out.push(fmt('Total', String(report.totals.lines), String(report.totals.files), '', ''));

  return out.join('\n');
}

async function scanPackage(pkg: Package): Promise<Report> {
  const byCategory: Record<string, Counts> = {};
  for (const pattern of pkg.categories) {
    byCategory[pattern] = { files: 0, lines: 0 };
  }
  byCategory[MISCELLANEOUS] = { files: 0, lines: 0 };

  const totals: Counts = { files: 0, lines: 0 };
  const glob = new Glob(SCAN_GLOB);
  for await (const file of glob.scan({ cwd: pkg.root, onlyFiles: true })) {
    if (EXCLUDE.some((p) => new Glob(p).match(file))) {
      continue;
    }
    const category = classify(file, pkg.categories);
    const lines = countNonBlankLines(join(pkg.root, file));
    byCategory[category]!.files += 1;
    byCategory[category]!.lines += lines;
    totals.files += 1;
    totals.lines += lines;
  }

  if (pkg.docsGlob) {
    byCategory[DOCS_CATEGORY] = { files: 0, lines: 0 };
    const docsGlob = new Glob(pkg.docsGlob);
    for await (const file of docsGlob.scan({ cwd: pkg.root, onlyFiles: true })) {
      const lines = countNonBlankLines(join(pkg.root, file));
      byCategory[DOCS_CATEGORY]!.files += 1;
      byCategory[DOCS_CATEGORY]!.lines += lines;
      totals.files += 1;
      totals.lines += lines;
    }
  }

  return { name: pkg.name, totals, byCategory };
}

async function main() {
  const asJson = process.argv.includes('--json');

  const reports: Report[] = [];
  for (const pkg of PACKAGES) {
    reports.push(await scanPackage(pkg));
  }

  if (asJson) {
    console.log(JSON.stringify({ packages: reports }, null, 2));
  } else {
    console.log(reports.map(renderSection).join('\n\n'));
  }
}

main();
