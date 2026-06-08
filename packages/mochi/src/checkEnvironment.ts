const MIN_BUN_VERSION = '1.3.13';
const MIN_SVELTE_VERSION = '5.55.1';

export function compareVersions(actual: string, required: string): boolean {
  const a = actual.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (r[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return true;
}

export async function checkEnvironment(): Promise<{ svelteVersion: string }> {
  if (typeof Bun === 'undefined') {
    throw new Error('Mochi requires the Bun runtime.');
  }

  if (!compareVersions(Bun.version, MIN_BUN_VERSION)) {
    throw new Error(`Mochi requires Bun ${MIN_BUN_VERSION} or higher (found ${Bun.version}).`);
  }

  let svelteVersion: string;
  try {
    const pkgPath = Bun.resolveSync('svelte/package.json', process.cwd());
    const pkg = (await Bun.file(pkgPath).json()) as { version: string };
    svelteVersion = pkg.version;
  } catch {
    throw new Error(`Mochi requires Svelte ${MIN_SVELTE_VERSION} or higher. Is svelte installed in your project?`);
  }

  if (!compareVersions(svelteVersion, MIN_SVELTE_VERSION)) {
    throw new Error(`Mochi requires Svelte ${MIN_SVELTE_VERSION} or higher (found ${svelteVersion}).`);
  }

  return { svelteVersion };
}
