export type SourceSpec = { label: string; path: string; lang?: string; showImageConfig?: boolean; showStaticDirs?: boolean };

export function isDemoIndex(path: string): boolean {
  return path.endsWith('demoIndex.ts');
}

// Drop a top-level `<key>: {…}` serve-option block (and its leading comment) — it's
// noise in every demo except the one whose feature it shows, which opts back in.
function stripServeBlock(code: string, key: string): string {
  const opener = new RegExp(`^\\s*${key}:\\s*\\{`);
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
    if (opener.test(line)) {
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

export function stripImageConfig(code: string): string {
  return stripServeBlock(code, 'image');
}

export function stripStaticDirs(code: string): string {
  return stripServeBlock(code, 'staticDirs');
}
