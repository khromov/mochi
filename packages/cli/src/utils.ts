import path from 'node:path';
import fs from 'node:fs';

const MOCHI_FRAMEWORK_FALLBACK = '^0.1.1';

const PRINT_WIDTH = 180;

/** Like `JSON.stringify(value, null, 2)` but with short primitive arrays kept on one line, so generated JSON passes `prettier --check` out of the box. */
export function stringifyJson(value: unknown): string {
  return renderJson(value, '', 0) + '\n';
}

// Hand-rolled because scaffolds run `prettier --check` on this output and `JSON.stringify(…, null, 2)` always expands arrays,
// while prettier inlines primitive arrays whose whole line fits printWidth — the two must agree (guarded by prettierCompat.test.ts).
function renderJson(value: unknown, indent: string, prefixWidth: number): string {
  if (Array.isArray(value)) {
    // JSON.stringify serializes undefined array elements as null; mirror that.
    const items = value.map((v) => (v === undefined ? null : v));
    if (items.length === 0) {
      return '[]';
    }
    if (items.every((v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      const inline = `[${items.map((v) => JSON.stringify(v)).join(', ')}]`;
      // The +1 reserves room for a trailing comma — prettier fits the whole `"key": […],` line into printWidth.
      if (indent.length + prefixWidth + inline.length + 1 <= PRINT_WIDTH) {
        return inline;
      }
    }
    const inner = indent + '  ';
    return `[\n${items.map((v) => inner + renderJson(v, inner, 0)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return '{}';
    }
    const inner = indent + '  ';
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${renderJson(v, inner, JSON.stringify(k).length + 2)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function validatePackageName(name: string): string | null {
  if (!name) {
    return 'Package name is required.';
  }
  if (name.length > 214) {
    return 'Package name must be 214 characters or less.';
  }
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
    return 'Package name must be lowercase and may only contain letters, digits, hyphens, dots, underscores, and tildes (optionally with an `@scope/` prefix).';
  }
  return null;
}

/** A warning string when `version` (e.g. `Bun.version`) is below the recommended Bun 1.4, else `null`. */
export function bunVersionWarning(version: string): string | null {
  const [major, minor] = version.split('.').map((n) => Number.parseInt(n, 10));
  if (major === undefined || Number.isNaN(major) || major > 1 || (major === 1 && (minor ?? 0) >= 4)) {
    return null;
  }
  return `Bun ${version} detected — create-mochi recommends Bun 1.4 or newer. Run \`bun upgrade\` first.`;
}

export function isDirEmpty(dir: string): boolean {
  if (!fs.existsSync(dir)) {
    return true;
  }
  try {
    return fs.readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

export async function fetchLatestMochiVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/mochi-framework/latest', {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

export function resolveMochiVersionRange(version: string | null): string {
  return version ? `^${version}` : MOCHI_FRAMEWORK_FALLBACK;
}

const BASE_TSCONFIG_COMPILER_OPTIONS = {
  lib: ['ESNext', 'DOM', 'DOM.Iterable'],
  target: 'ESNext',
  module: 'Preserve',
  moduleDetection: 'force',
  jsx: 'react-jsx',
  allowJs: true,
  moduleResolution: 'bundler',
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  noPropertyAccessFromIndexSignature: false,
} as const;

export interface PackageJsonTransform {
  name: string;
  /** Version range to swap in for any `workspace:*` dep on `mochi-framework`. */
  mochiVersion: string;
  /** Scaffold root; its `patches/` dir seeds `patchedDependencies`. */
  dir: string;
}

export function transformPackageJson(contents: string, opts: PackageJsonTransform): string {
  const pkg = JSON.parse(contents) as Record<string, unknown>;
  pkg.name = opts.name;

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (!deps) {
      continue;
    }
    for (const [dep, version] of Object.entries(deps)) {
      if (version === 'workspace:*' || version.startsWith('workspace:')) {
        deps[dep] = dep === 'mochi-framework' ? opts.mochiVersion : 'latest';
      }
    }
  }

  // Can't live in the committed template `package.json` because bun resolves a workspace's
  // `patchedDependencies` path against the monorepo root, so we wire it up here instead.
  // Deriving the map from the template's own `patches/` files (rather than a hardcoded list)
  // means a published CLI never drifts behind a template's dep bumps.
  const patched = derivePatchedDependencies(path.join(opts.dir, 'patches'));
  if (Object.keys(patched).length > 0) {
    pkg.patchedDependencies = patched;
  }

  return stringifyJson(pkg);
}

// bun's convention makes each patch filename (`svelte-check@4.7.4.patch`) exactly
// the `name@version` key, so the map is the directory listing — no version parsing.
function derivePatchedDependencies(patchesDir: string): Record<string, string> {
  if (!fs.existsSync(patchesDir)) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const file of fs.readdirSync(patchesDir).sort()) {
    if (!file.endsWith('.patch')) {
      continue;
    }
    map[file.slice(0, -'.patch'.length)] = `patches/${file}`;
  }
  return map;
}

export function transformTsconfig(contents: string): string {
  const cfg = JSON.parse(contents) as { extends?: string; compilerOptions?: Record<string, unknown> };
  if (cfg.extends && cfg.extends.includes('tsconfig.base.json')) {
    delete cfg.extends;
    cfg.compilerOptions = {
      ...BASE_TSCONFIG_COMPILER_OPTIONS,
      ...cfg.compilerOptions,
    };
  }
  return stringifyJson(cfg);
}

export function setDefaultPort(contents: string, port: number): string {
  return contents.replace(/(const PORT = Number\(process\.env\.PORT\) \|\| )\d+(;)/, `$1${port}$2`);
}

/** Drop a Dockerfile's baked-in `ENV PORT` line so the app falls back to the platform-injected `$PORT`. */
export function stripDockerfileEnvPort(contents: string): string {
  return contents.replace(/^ENV PORT=\S+[ \t]*\r?\n/m, '');
}

/** Retarget a `.dockerignore` `Dockerfile` entry at `Dockerfile.vercel` after the rename. */
export function retargetDockerignore(contents: string): string {
  return contents.replace(/^Dockerfile[ \t]*$/m, 'Dockerfile.vercel');
}

const DEFAULT_GITIGNORE = `node_modules
.mochi
.mochi-*
out
*.tgz
.env
.env.local
.DS_Store
*.log
`;

/** Write a default `.gitignore` if the template didn't ship one. */
export function ensureGitignore(dir: string): void {
  const target = path.join(dir, '.gitignore');
  if (fs.existsSync(target)) {
    return;
  }
  fs.writeFileSync(target, DEFAULT_GITIGNORE);
}
