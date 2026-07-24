import { compile as svelteCompile, compileModule as svelteCompileModule, VERSION as SVELTE_VERSION, type CompileOptions } from 'svelte/compiler';
import { logger } from '../utils/log';

/**
 * Which Svelte compiler implementation compiles `.svelte` / `.svelte.[jt]s`
 * sources. `'rsvelte'` requires the optional `@mochi-framework/rsvelte` adapter
 * package to be installed — without it the framework warns and falls back to
 * `'svelte'` rather than failing the build.
 */
export type MochiSvelteCompiler = 'svelte' | 'rsvelte';

/** Shape of a compile result the framework consumes. Structurally a subset of Svelte's own. */
export interface SvelteCompileOutput {
  js: { code: string };
  css?: { code: string } | null;
}

/**
 * The compiler surface `ComponentRegistry` depends on. Deliberately narrower
 * than `svelte/compiler`: `parse()` (island preprocessing) and `preprocess()`
 * always run on the official compiler, because alternative backends don't
 * produce an upstream-shaped AST.
 */
export interface SvelteCompilerBackend {
  /** Stable id, e.g. `'svelte'` or `'rsvelte'`. */
  readonly name: string;
  /** Backend version — folded into the compile-cache fingerprint so a swap invalidates it. */
  readonly version: string;
  compile(source: string, options: CompileOptions): SvelteCompileOutput;
  compileModule(source: string, options: CompileOptions): SvelteCompileOutput;
}

export const officialBackend: SvelteCompilerBackend = {
  name: 'svelte',
  version: SVELTE_VERSION,
  compile: (source, options) => svelteCompile(source, options),
  compileModule: (source, options) => svelteCompileModule(source, options),
};

/**
 * Bare specifier of the optional adapter package. Held in a variable so the
 * `import()` below is never statically analysable — an absent optional peer must
 * be a caught runtime rejection, not a resolution failure at load time.
 */
const RSVELTE_SPECIFIER = '@mochi-framework/rsvelte';

const ENV_VAR = 'MOCHI_SVELTE_COMPILER';

/** @internal Exported so the fallback path can be tested without a broken install. */
export function isBackend(value: unknown): value is SvelteCompilerBackend {
  const b = value as Partial<SvelteCompilerBackend> | undefined;
  return typeof b?.compile === 'function' && typeof b.compileModule === 'function' && typeof b.name === 'string' && typeof b.version === 'string';
}

/**
 * `MOCHI_SVELTE_COMPILER` wins over the `Mochi.serve()` option so a backend can
 * be A/B'd on an existing app without editing code. An unrecognised value is a
 * typo, not a silent opt-out — warn and keep the configured choice.
 */
function effectiveChoice(configured: MochiSvelteCompiler | undefined): MochiSvelteCompiler {
  const env = process.env[ENV_VAR];
  if (env === 'svelte' || env === 'rsvelte') {
    return env;
  }
  // A typo'd env var would otherwise re-warn on every registry build — a dev
  // server rebuilds many times per session.
  if (env && !envWarned.has(env)) {
    envWarned.add(env);
    logger.warn(`${ENV_VAR}=${JSON.stringify(env)} is not a known compiler ('svelte' | 'rsvelte') — ignoring.`);
  }
  return configured ?? 'svelte';
}

// Resolution is memoized per choice: a dev server constructs several registries
// over its lifetime and each would otherwise re-import the native binding.
const resolved = new Map<MochiSvelteCompiler, Promise<SvelteCompilerBackend>>();
const announced = new Set<string>();
const envWarned = new Set<string>();

/**
 * @internal Load, validate and fall back — with the module loader injected so a
 * test can exercise a rejected import or a malformed export without uninstalling
 * the adapter. Never throws.
 */
export async function loadRsvelte(load: () => Promise<unknown> = () => import(RSVELTE_SPECIFIER)): Promise<SvelteCompilerBackend> {
  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    logger.warn(
      `svelteCompiler: 'rsvelte' was requested but ${RSVELTE_SPECIFIER} could not be loaded — falling back to svelte/compiler. ` +
        `Install it with \`bun add -d ${RSVELTE_SPECIFIER}\`. (${err instanceof Error ? err.message : String(err)})`,
    );
    return officialBackend;
  }
  const exported = (mod as { svelteCompilerBackend?: unknown } | null)?.svelteCompilerBackend;
  if (!isBackend(exported)) {
    logger.warn(`${RSVELTE_SPECIFIER} did not export a usable \`svelteCompilerBackend\` — falling back to svelte/compiler.`);
    return officialBackend;
  }
  return exported;
}

/** Resolve the compiler backend for a registry. Never throws — an unusable backend degrades to `svelte`. */
export async function resolveSvelteCompiler(configured?: MochiSvelteCompiler): Promise<SvelteCompilerBackend> {
  const choice = effectiveChoice(configured);
  if (choice === 'svelte') {
    return officialBackend;
  }
  let pending = resolved.get(choice);
  if (!pending) {
    pending = loadRsvelte();
    resolved.set(choice, pending);
  }
  const backend = await pending;
  const id = backendId(backend);
  if (!announced.has(id)) {
    announced.add(id);
    logger.info(`Svelte compiler: ${id}`);
  }
  return backend;
}

/** Cache-fingerprint identity for a backend. */
export function backendId(backend: SvelteCompilerBackend): string {
  return `${backend.name}@${backend.version}`;
}

/** Test-only: drop the memoized resolutions so a test can exercise a different env/choice. */
export function resetSvelteCompilerCache(): void {
  resolved.clear();
  announced.clear();
  envWarned.clear();
}
