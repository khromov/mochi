import { statSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import prettyBytes from '../vendor/pretty-bytes';
import type { LocalImageAsset } from '../image/types';

export interface ResourceRow {
  /** Emitted (content-hashed) filename, as written under `<outDir>/assets/`. */
  name: string;
  dimensions: string;
  bytes: number;
}

/**
 * Rows for the build's resources list, largest first so an oversized import is
 * the first thing you read. Name breaks ties to keep runs byte-identical.
 */
export function collectImageResources(assets: Iterable<LocalImageAsset>): ResourceRow[] {
  const rows: ResourceRow[] = [];
  for (const asset of assets) {
    rows.push({ name: path.basename(asset.diskPath), dimensions: `${asset.width}×${asset.height}`, bytes: sizeOnDisk(asset.diskPath) });
  }
  return rows.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
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

/** Same layout as the route tree in `build.ts`, so the two blocks read as one report. */
export function printResourceTree(rows: ResourceRow[]): void {
  if (rows.length === 0) {
    return;
  }

  const sizes = rows.map((r) => prettyBytes(r.bytes));
  const nameWidth = Math.max('Resource'.length, ...rows.map((r) => r.name.length));
  const dimWidth = Math.max('dimensions'.length, ...rows.map((r) => r.dimensions.length));
  const sizeWidth = Math.max('size'.length, ...sizes.map((s) => s.length));

  console.log('');
  console.log(styleText('dim', `      ${'Resource'.padEnd(nameWidth + 2)}  ${'dimensions'.padStart(dimWidth)}  ${'size'.padStart(sizeWidth)}`));

  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const { name, dimensions } = rows[i]!;
    const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
    console.log(
      `  ${char} ${styleText('yellow', '▣')} ${name.padEnd(nameWidth + 2)}  ${styleText('dim', dimensions.padStart(dimWidth))}  ${styleText('dim', sizes[i]!.padStart(sizeWidth))}`,
    );
  }

  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  console.log(styleText('dim', `\n  ${n} asset${n === 1 ? '' : 's'} · ${prettyBytes(total)}`));
}
