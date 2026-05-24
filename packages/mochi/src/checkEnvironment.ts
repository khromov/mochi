import path from 'node:path';
import { logger } from './log';

const MIN_BUN_VERSION = '1.3.13';
const MIN_SVELTE_VERSION = '5.55.1';

const PRELOAD_MARKER = 'mochi-framework/plugin';

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

export async function checkEnvironment(): Promise<void> {
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
}

export async function ensureBunfigPreload(): Promise<boolean> {
  const bunfigPath = path.resolve(process.cwd(), 'bunfig.toml');
  const file = Bun.file(bunfigPath);

  if (await file.exists()) {
    const content = await file.text();
    if (content.includes(PRELOAD_MARKER)) {
      return false;
    }
    if (/^\s*preload\s*=/m.test(content)) {
      logger.warn(`[mochi] bunfig.toml has a preload entry but is missing "${PRELOAD_MARKER}". Add it manually to enable Svelte component imports in routes.`);
      return false;
    }
    await Bun.write(bunfigPath, content.trimEnd() + '\n\n[run]\npreload = ["mochi-framework/plugin"]\n');
  } else {
    await Bun.write(bunfigPath, '[run]\npreload = ["mochi-framework/plugin"]\n');
  }

  logger.info('[mochi] Created bunfig.toml with the mochi-framework plugin preload. Restart the server to enable Svelte component imports in routes.');
  return true;
}
