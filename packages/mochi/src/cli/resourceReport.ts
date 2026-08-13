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

export interface ChunkRow {
  /** User-assigned name(s) from `clientBundle.chunks`. More than one means two groups landed in the same output. */
  chunkNames: string[];
  modules: number;
  bytes: number;
}

/**
 * The build console is the only place a manual chunk is ever visible: chunking is production-only, while the debug bar
 * and the client-stats page are both gated on `development`.
 *
 * `notFormed` names groups whose modules never became a shared chunk — the one case where a user most needs telling,
 * since the config looks like it worked. A group that only partly moved never reaches here: that fails the build.
 */
export function printChunkTree(rows: ChunkRow[], skipped: { id: string; reason: string }[], notFormed: string[] = []): void {
  if (rows.length === 0 && skipped.length === 0 && notFormed.length === 0) {
    return;
  }

  const label = (r: ChunkRow) => r.chunkNames.join(' + ');
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes || label(a).localeCompare(label(b)));

  if (sorted.length > 0) {
    const sizes = sorted.map((r) => prettyBytes(r.bytes));
    const nameWidth = Math.max('Chunk'.length, ...sorted.map((r) => label(r).length));
    const modWidth = Math.max('modules'.length, ...sorted.map((r) => String(r.modules).length));
    const sizeWidth = Math.max('size'.length, ...sizes.map((s) => s.length), 4);

    console.log('');
    console.log(styleText('dim', `      ${'Chunk'.padEnd(nameWidth + 2)}  ${'modules'.padStart(modWidth)}  ${'size'.padStart(sizeWidth)}`));

    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      const row = sorted[i]!;
      const char = styleText('dim', n === 1 ? '─' : i === 0 ? '┌' : i === n - 1 ? '└' : '├');
      console.log(
        `  ${char} ${styleText('cyan', '▤')} ${label(row).padEnd(nameWidth + 2)}  ${styleText('dim', String(row.modules).padStart(modWidth))}  ${styleText('dim', sizes[i]!.padStart(sizeWidth))}`,
      );
    }

    const total = sorted.reduce((sum, r) => sum + r.bytes, 0);
    console.log(styleText('dim', `\n  ${n} chunk${n === 1 ? '' : 's'} · ${prettyBytes(total)}`));
  }

  for (const name of notFormed) {
    console.log(styleText('yellow', `  no shared chunk: ${name} — its modules are reached from one island entry, which already carries them.`));
  }
  // One skipped-module line each buries the report when a dependency is mostly barrels — 111 of them on this site's own
  // build — so identical reasons collapse to a count with a couple of examples.
  const EXAMPLES = 2;
  const byReason = new Map<string, string[]>();
  for (const s of skipped) {
    byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.id]);
  }
  for (const [reason, ids] of byReason) {
    if (ids.length === 1) {
      console.log(styleText('yellow', `  left in place: ${ids[0]} — ${reason}.`));
      continue;
    }
    console.log(styleText('yellow', `  left in place: ${ids.length} modules — ${reason}.`));
    console.log(styleText('dim', `    e.g. ${ids.slice(0, EXAMPLES).join(', ')}${ids.length > EXAMPLES ? `, …` : ''}`));
  }
}
