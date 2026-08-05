export type SourceSpec = { label: string; path: string; lang?: string; showImageConfig?: boolean };

export function isDemoIndex(path: string): boolean {
  return path.endsWith('demoIndex.ts');
}

// Drop the `image: {…}` block (and its leading comment) — it's noise in every demo
// except the image ones, which opt back in via `showImageConfig`.
export function stripImageConfig(code: string): string {
  const lines = code.split('\n');
  const out: string[] = [];
  let depth = 0;
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (depth <= 0) {
        skipping = false;
      }
      continue;
    }
    if (/^\s*image:\s*\{/.test(line)) {
      while (out.length && /^\s*\/\//.test(out[out.length - 1]!)) {
        out.pop();
      }
      depth = (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      skipping = depth > 0;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
