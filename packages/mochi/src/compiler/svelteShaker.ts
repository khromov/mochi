import { logger } from '../utils/log';

export interface ShakeAppResult {
  /** absPath → slimmed `.svelte` source for every in-scope component. */
  shaken: Map<string, string>;
  /** absPath → original on-disk source, captured during the shake's own reads */
  originals: Map<string, string>;
}

/**
 * The whole-program optimizer surface `ComponentRegistry` depends on, implemented by the optional
 * `@mochi-framework/svelte-shaker` package — which also owns the engine's dependency tree, so apps that never set
 * `optimize` don't install it.
 */
export interface SvelteShakerBackend {
  /** Stable id, e.g. `'svelte-shaker'`. */
  readonly name: string;
  /** Engine version, announced once at boot so a bump is visible in build logs. */
  readonly version: string;
  shakeApp(appRoot: string): Promise<ShakeAppResult>;
}

// Held in a variable so the `import()` below stays statically unanalysable: an absent optional peer must surface as a
// caught runtime rejection rather than a load-time resolution failure.
const SHAKER_SPECIFIER = '@mochi-framework/svelte-shaker';

/** @internal Exported so the fallback path can be tested without a broken install. */
export function isShakerBackend(value: unknown): value is SvelteShakerBackend {
  const b = value as Partial<SvelteShakerBackend> | undefined;
  return typeof b?.shakeApp === 'function' && typeof b.name === 'string' && typeof b.version === 'string';
}

/**
 * @internal Load, validate and degrade to `null` — with the module loader injected so a test can exercise a rejected
 * import or a malformed export without uninstalling the adapter. Never throws.
 */
export async function loadSvelteShaker(load: () => Promise<unknown> = () => import(SHAKER_SPECIFIER)): Promise<SvelteShakerBackend | null> {
  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    logger.warn(
      `svelte-shaker: \`optimize\` is enabled but ${SHAKER_SPECIFIER} could not be loaded — building from original sources. ` +
        `Install it with \`bun add -d ${SHAKER_SPECIFIER}\`. (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
  const exported = (mod as { svelteShakerBackend?: unknown } | null)?.svelteShakerBackend;
  if (!isShakerBackend(exported)) {
    logger.warn(`svelte-shaker: ${SHAKER_SPECIFIER} did not export a usable \`svelteShakerBackend\` — building from original sources.`);
    return null;
  }
  return exported;
}

// Memoized so the "not installed" warning fires once even though a dev server
// constructs several registries over its lifetime.
let pending: Promise<SvelteShakerBackend | null> | undefined;
const announced = new Set<string>();

/**
 * Resolve the optimizer backend, or `null` when it isn't installed or is unusable. Never throws — the caller skips
 * shaking. `load` exists only so a test can pick the outcome: the add-on always resolves inside this workspace.
 */
export async function resolveSvelteShaker(load?: () => Promise<unknown>): Promise<SvelteShakerBackend | null> {
  pending ??= loadSvelteShaker(load);
  const backend = await pending;
  if (backend) {
    const id = `${backend.name}@${backend.version}`;
    if (!announced.has(id)) {
      announced.add(id);
      logger.info(`svelte-shaker: ${id}`);
    }
  }
  return backend;
}

/** Test-only: drop the memoized resolution so a test can exercise a different loader. */
export function resetSvelteShakerCache(): void {
  pending = undefined;
  announced.clear();
}
