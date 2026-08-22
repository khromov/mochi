import { statSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import prettyBytes from '../vendor/pretty-bytes';
import type { LocalImageAsset } from '../image/types';
import { toPosixPath } from '../utils';

export interface ResourceRow {
  /** Emitted (content-hashed) filename, as written under the build output directory. */
  name: string;
  /** Optional second column — image dimensions today; omitted for rows that have none. */
  detail?: string;
  bytes: number;
  /** Overrides the section glyph — marks a row that stands for many files, or a kind of its own. */
  glyph?: string;
  /** Overrides the section colour, so a kind sharing a section still reads as itself. */
  color?: Parameters<typeof styleText>[0];
  /** Number of files this row stands for. Set only on aggregate rows. */
  files?: number;
}

const isAggregate = (row: ResourceRow) => row.files !== undefined;

/**
 * Individual files largest first, so an oversized asset is the first thing you
 * read; name breaks ties to keep runs byte-identical. Aggregate rows are pinned
 * above them rather than ranked by size — they summarise a whole class of output,
 * so burying one mid-list reads as if it were just another file.
 */
function sortRows(rows: ResourceRow[]): ResourceRow[] {
  const bySize = (a: ResourceRow, b: ResourceRow) => b.bytes - a.bytes || a.name.localeCompare(b.name);
  return [...rows.filter(isAggregate).sort(bySize), ...rows.filter((r) => !isAggregate(r)).sort(bySize)];
}

export function collectImageResources(assets: Iterable<LocalImageAsset>): ResourceRow[] {
  const rows: ResourceRow[] = [];
  for (const asset of assets) {
    rows.push({ name: path.basename(asset.diskPath), detail: `${asset.width}×${asset.height}`, bytes: sizeOnDisk(asset.diskPath) });
  }
  return sortRows(rows);
}

/** Rows for fonts extracted from imported CSS, sharing the images' section. */
export function collectFontResources(fonts: Iterable<{ diskPath: string }>): ResourceRow[] {
  const rows: ResourceRow[] = [];
  for (const font of fonts) {
    rows.push({ name: path.basename(font.diskPath), detail: '—', bytes: sizeOnDisk(font.diskPath), glyph: 'ƒ', color: 'magenta' });
  }
  return sortRows(rows);
}

/** One largest-first list across resource kinds, so the section reads as a single table. */
export function mergeResourceRows(...groups: ResourceRow[][]): ResourceRow[] {
  return sortRows(groups.flat());
}

/** One row standing in for many files, so a long tail of small outputs stays one line. */
const AGGREGATE_GLYPH = '◇';

function aggregateRow(label: string, diskPaths: string[]): ResourceRow | null {
  if (diskPaths.length === 0) {
    return null;
  }
  return {
    name: `${label} (${diskPaths.length} file${diskPaths.length === 1 ? '' : 's'})`,
    bytes: diskPaths.reduce((sum, p) => sum + sizeOnDisk(p), 0),
    glyph: AGGREGATE_GLYPH,
    files: diskPaths.length,
  };
}

/**
 * Every stylesheet the build emits: one row per CSS-import bundle, plus a single
 * aggregate row for the per-component Svelte styles — there is one of those per
 * component with a `<style>` block (151 on this repo's site), each a few kB.
 *
 * Takes served URL → absolute disk path, not the registry's own `clientFiles`,
 * whose values are file *contents*. The manifest's own values are out-dir
 * relative, so the caller resolves them first.
 */
export function collectStyleResources(clientFiles: Record<string, string>, assetPrefix: string): ResourceRow[] {
  const importPrefix = `${assetPrefix}/import-css/`;
  const componentPrefix = `${assetPrefix}/css/`;
  const rows: ResourceRow[] = [];
  const componentCss: string[] = [];
  for (const [urlPath, diskPath] of Object.entries(clientFiles)) {
    if (urlPath.startsWith(importPrefix)) {
      rows.push({ name: path.basename(urlPath), bytes: sizeOnDisk(diskPath) });
    } else if (urlPath.startsWith(componentPrefix)) {
      componentCss.push(diskPath);
    }
  }
  const aggregate = aggregateRow('component styles', componentCss);
  if (aggregate) {
    rows.push(aggregate);
  }
  return sortRows(rows);
}

/**
 * Every script the build emits: one row per island entry bundle (the bytes a page
 * pays to hydrate that island) and the island bootstrap, plus one aggregate row
 * for the shared chunks they import — those are split by the bundler and belong
 * to no single island, so listing them individually would say nothing actionable.
 *
 * Islands are identified from `componentEntryUrls` rather than by filename, so
 * the split holds if the bundler's naming ever changes.
 */
export function collectScriptResources(
  clientFiles: Record<string, string>,
  assetPrefix: string,
  componentEntryUrls: Record<string, string>,
  bootstrapUrl: string | null,
): ResourceRow[] {
  const prefix = `${assetPrefix}/client/`;
  // Several component names can share one entry URL (an island used on many
  // pages), so dedupe before sizing or the bytes would be counted twice.
  const entryUrls = new Set(Object.values(componentEntryUrls));
  const rows: ResourceRow[] = [];
  const chunks: string[] = [];
  for (const [urlPath, diskPath] of Object.entries(clientFiles)) {
    if (!urlPath.startsWith(prefix)) {
      continue;
    }
    if (entryUrls.has(urlPath) || urlPath === bootstrapUrl) {
      rows.push({ name: path.basename(urlPath), bytes: sizeOnDisk(diskPath) });
    } else {
      chunks.push(diskPath);
    }
  }
  const aggregate = aggregateRow('shared chunks', chunks);
  if (aggregate) {
    rows.push(aggregate);
  }
  return sortRows(rows);
}

// A report must never fail a build that otherwise succeeded, so an asset that
// vanished between emit and report is listed at zero rather than throwing.
function sizeOnDisk(diskPath: string): number {
  try {
    return statSync(diskPath).size;
  } catch {
    return 0;
  }
}

interface SectionOptions {
  glyph: string;
  color: Parameters<typeof styleText>[0];
  /** Header for the middle column. Omit when no row carries a `detail`. */
  detailHeader?: string;
}

/** Same layout as the route tree in `build.ts`, so every block reads as one report. */
export function printResourceSection(header: string, rows: ResourceRow[], opts: SectionOptions): void {
  if (rows.length === 0) {
    return;
  }

  const sizes = rows.map((r) => prettyBytes(r.bytes));
  const showDetail = rows.some((r) => r.detail);
  const detailHeader = opts.detailHeader ?? '';
  const nameWidth = Math.max(header.length, ...rows.map((r) => r.name.length));
  const detailWidth = Math.max(detailHeader.length, ...rows.map((r) => r.detail?.length ?? 0));
  const sizeWidth = Math.max('size'.length, ...sizes.map((s) => s.length));
  const detailCol = (text: string) => (showDetail ? `  ${text.padStart(detailWidth)}` : '');

  console.log('');
  console.log(styleText('dim', `      ${header.padEnd(nameWidth + 2)}${detailCol(detailHeader)}  ${'size'.padStart(sizeWidth)}`));

  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const { name, detail, glyph, color } = rows[i]!;
    const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
    const detailText = showDetail ? styleText('dim', detailCol(detail ?? '')) : '';
    console.log(`  ${char} ${styleText(color ?? opts.color, glyph ?? opts.glyph)} ${name.padEnd(nameWidth + 2)}${detailText}  ${styleText('dim', sizes[i]!.padStart(sizeWidth))}`);
  }

  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  // Counts files, not rows — an aggregate row stands for many, and a subtotal
  // that said "5 entries" for 155 files would understate what the section covers.
  const fileCount = rows.reduce((sum, r) => sum + (r.files ?? 1), 0);
  console.log(styleText('dim', `\n  ${fileCount} file${fileCount === 1 ? '' : 's'} · ${prettyBytes(total)}`));
}

/**
 * Static files get a count and a total, never a listing — a `public/` directory
 * can hold thousands of files, and none of them are built.
 */
export function printStaticSummary(publicDir: string, count: number, bytes: number): void {
  if (count === 0) {
    return;
  }
  console.log('');
  console.log(styleText('dim', `      Static files`));
  console.log(
    `  ${styleText('dim', '─')} ${styleText('blue', '▢')} ${toPosixPath(publicDir)}  ${styleText('dim', `${count} file${count === 1 ? '' : 's'} · ${prettyBytes(bytes)}`)}`,
  );
}
