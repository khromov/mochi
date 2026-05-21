import path from 'node:path';
import fs from 'node:fs';

const MOCHI_FRAMEWORK_FALLBACK = 'latest';

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
  /** Replace the `name` field. */
  name: string;
  /** Version range to swap in for any `workspace:*` dep on `mochi-framework`. */
  mochiVersion: string;
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

  return JSON.stringify(pkg, null, 2) + '\n';
}

export function transformTsconfig(contents: string): string {
  const cfg = JSON.parse(contents) as { extends?: string; compilerOptions?: Record<string, unknown> };
  if (cfg.extends && cfg.extends.includes('tsconfig.base.json')) {
    delete cfg.extends;
    cfg.compilerOptions = {
      ...BASE_TSCONFIG_COMPILER_OPTIONS,
      ...(cfg.compilerOptions ?? {}),
    };
  }
  return JSON.stringify(cfg, null, 2) + '\n';
}

export function setDefaultPort(contents: string, port: number): string {
  return contents.replace(/(const PORT = Number\(process\.env\.PORT\) \|\| )\d+(;)/, `$1${port}$2`);
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
