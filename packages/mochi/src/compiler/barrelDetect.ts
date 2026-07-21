/**
 * Detect "barrel import" smells from a finished `Bun.build` metafile.
 *
 * Bun does NOT pull a barrel's thousands of modules into the graph — it
 * tree-shakes them. What it can't avoid is parsing the single large re-export
 * index the barrel resolves to (e.g. `@lucide/svelte`'s ~108 KB
 * `dist/icons/index.js`) and then dropping ~all of it. That re-parse happens on
 * every rebuild, so the cost shows up as slow dev rebuilds. The fingerprint is a
 * large `node_modules` input whose `bytesInOutput` is ≈ 0 — high parse cost, ~no
 * payload — not a module count.
 */

export interface BarrelMetafile {
  inputs: Record<string, { bytes: number }>;
  outputs: Record<string, { inputs?: Record<string, { bytesInOutput: number }> }>;
}

export interface HeavyBarrel {
  pkg: string;
  file: string;
  bytes: number;
  usedRatio: number;
}

/** A file used for less than this fraction of its parsed size is "barely used". */
const BARREL_USED_RATIO = 0.05;

// Strip Bun's `node_modules/` / `.bun/<id>/node_modules/` prefixes, mirroring
// ComponentRegistry.cleanInputPath, so paths normalize to `<pkg>/<...>`.
const NODE_MODULES_PREFIX = /^(?:\.\.\/)*node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?/;

function packageOf(file: string): string {
  const seg = file.split('/');
  return file.startsWith('@') ? seg.slice(0, 2).join('/') : (seg[0] ?? '');
}

export function detectHeavyBarrels(metafile: BarrelMetafile, minBytes: number, ignore: Set<string>): HeavyBarrel[] {
  const usedByInput = new Map<string, number>();
  for (const out of Object.values(metafile.outputs)) {
    for (const [p, m] of Object.entries(out.inputs ?? {})) {
      usedByInput.set(p, (usedByInput.get(p) ?? 0) + m.bytesInOutput);
    }
  }

  const found: HeavyBarrel[] = [];
  for (const [rawPath, meta] of Object.entries(metafile.inputs)) {
    // Anchor on the prefix match (not a bare `.includes`) so a mid-path
    // `node_modules/` can't be mis-stripped into a bogus package name.
    const nmPrefix = NODE_MODULES_PREFIX.exec(rawPath);
    if (!nmPrefix || meta.bytes < minBytes) {
      continue;
    }
    const usedRatio = (usedByInput.get(rawPath) ?? 0) / meta.bytes;
    if (usedRatio >= BARREL_USED_RATIO) {
      continue;
    }
    const file = rawPath.slice(nmPrefix[0].length);
    const pkg = packageOf(file);
    if (ignore.has(pkg)) {
      continue;
    }
    found.push({ pkg, file, bytes: meta.bytes, usedRatio });
  }
  return found.sort((a, b) => b.bytes - a.bytes);
}

/** Render a barrel's tree-shaken-survivor ratio as a human percentage (≈ 0 for a real barrel). */
export function formatUsedRatio(ratio: number): string {
  const pct = ratio * 100;
  if (pct <= 0) {
    return '0%';
  }
  if (pct < 0.1) {
    return '<0.1%';
  }
  return `${pct.toFixed(1)}%`;
}

/** The per-package warning line emitted live in dev. */
export function formatBarrelLine(b: HeavyBarrel): string {
  const kb = Math.round(b.bytes / 1024);
  return (
    `Heavy barrel import: "${b.pkg}" parses ${b.file} (${kb} KB) on every rebuild but uses only ${formatUsedRatio(b.usedRatio)} of it. ` +
    `This slows rebuilds — import from a sub-path instead (e.g. '@lucide/svelte/icons/sun'). ` +
    `Silence via Mochi.serve({ barrelWarnings: { ignore: ['${b.pkg}'] } }) or barrelWarnings: false.`
  );
}

/** One grouped summary line for a whole build, so a noisy build isn't buried in per-package warnings. */
export function formatBarrelSummary(barrels: HeavyBarrel[]): string {
  const n = barrels.length;
  const totalKb = Math.round(barrels.reduce((sum, b) => sum + b.bytes, 0) / 1024);
  // Callers may hand us barrels collected across multiple compile passes
  // (server then client), so sort here rather than trust the incoming order.
  const worst = [...barrels]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map((b) => `${b.pkg} (${Math.round(b.bytes / 1024)} KB, ${formatUsedRatio(b.usedRatio)} used)`)
    .join(', ');
  const more = n > 3 ? `, +${n - 3} more` : '';
  return (
    `${n} heavy barrel import${n === 1 ? '' : 's'} parsed but barely used (${totalKb} KB total) — slows builds. ` +
    `Import from sub-paths (e.g. '@lucide/svelte/icons/sun'). Worst: ${worst}${more}. ` +
    `Silence via barrelWarnings: false.`
  );
}
