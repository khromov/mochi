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
    if (!rawPath.includes('node_modules/') || meta.bytes < minBytes) {
      continue;
    }
    const usedRatio = (usedByInput.get(rawPath) ?? 0) / meta.bytes;
    if (usedRatio >= BARREL_USED_RATIO) {
      continue;
    }
    const file = rawPath.replace(NODE_MODULES_PREFIX, '');
    const pkg = packageOf(file);
    if (ignore.has(pkg)) {
      continue;
    }
    found.push({ pkg, file, bytes: meta.bytes, usedRatio });
  }
  return found.sort((a, b) => b.bytes - a.bytes);
}
