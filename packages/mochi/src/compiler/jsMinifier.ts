/**
 * Post-bundle JS minification for the browser-facing builds. Bun's own minifier runs inside `Bun.build`; selecting
 * `'oxc'` runs a second, stronger pass over the emitted chunks with the optional `oxc-minify` peer.
 *
 * The pass is post-bundle rather than a plugin hook on purpose: `onLoad` sees one pre-bundle module at a time and Bun
 * re-prints whatever it returns, and Bun 1.4's `onEnd` is observation-only — its callback returns `void` and fires
 * after `outdir` has already been written.
 *
 * Bun's own `minify` deliberately stays fully on underneath: measured over the site's bundle, oxc alone lands ~3.4%
 * *worse* on gzip than Bun-then-oxc, because Bun mangles identifiers across the whole split graph while oxc only sees
 * one already-split chunk at a time and must preserve its import/export names.
 */
import path from 'node:path';
import type { BuildArtifact } from 'bun';
import { logger } from '../utils/log';

export type MochiJsMinifier = 'bun' | 'oxc';

export const DEFAULT_JS_MINIFIER: MochiJsMinifier = 'bun';

export const MINIFIER_ENV_VAR = 'MOCHI_MINIFIER';

export function isJsMinifier(value: unknown): value is MochiJsMinifier {
  return value === 'bun' || value === 'oxc';
}

/** Validate one source of the setting; `source` names it in the error, since a typo must not silently mean `'bun'`. */
export function parseJsMinifier(value: unknown, source: string): MochiJsMinifier {
  if (!isJsMinifier(value)) {
    throw new Error(`Unknown minifier ${JSON.stringify(value)} from ${source}. Expected 'bun' or 'oxc'.`);
  }
  return value;
}

export interface JsMinifierSources {
  /** `mochi-framework build --minifier`. */
  flag?: unknown;
  /** `Mochi.serve({ minifier })` in the entry. */
  configured?: unknown;
  /** Defaults to `process.env.MOCHI_MINIFIER`; an empty string counts as unset. */
  env?: string;
}

/**
 * The single place the setting is resolved: `--minifier` > `MOCHI_MINIFIER` > the entry's `minifier` > `'bun'`. Every
 * source that is set is validated, including ones a higher-precedence source overrides.
 */
export function resolveJsMinifier({ flag, configured, env = process.env[MINIFIER_ENV_VAR] }: JsMinifierSources = {}): MochiJsMinifier {
  const fromFlag = flag === undefined ? undefined : parseJsMinifier(flag, '--minifier');
  const fromEnv = env === undefined || env === '' ? undefined : parseJsMinifier(env, MINIFIER_ENV_VAR);
  const fromConfig = configured === undefined ? undefined : parseJsMinifier(configured, 'Mochi.serve({ minifier })');
  return fromFlag ?? fromEnv ?? fromConfig ?? DEFAULT_JS_MINIFIER;
}

interface OxcError {
  severity: 'Error' | 'Warning' | 'Advice';
  message: string;
  codeframe: string | null;
}

interface OxcMinifyResult {
  code: string;
  errors: OxcError[];
}

interface OxcMinifyOptions {
  module?: boolean;
  compress?: { target?: string; dropDebugger?: boolean; dropConsole?: boolean; treeshake?: { propertyReadSideEffects?: boolean | 'always' } };
  codegen?: { legalComments?: 'none' | 'inline' | 'eof' };
}

type OxcMinifyFn = (filename: string, sourceText: string, options?: OxcMinifyOptions) => Promise<OxcMinifyResult>;

export interface OxcMinifier {
  minify: OxcMinifyFn;
  version: string;
}

/**
 * Every default where oxc disagrees with the Bun pass it runs after, pinned so the second pass only shrinks the
 * bundle and never changes what it does:
 *
 * - `legalComments` defaults to `'none'`, which silently strips the `/*!` / `@license` banners Bun preserves — a
 *   licence-compliance regression, so it is forced back to `'inline'`.
 * - `dropDebugger` defaults to `true`; Bun keeps `debugger` statements, and this pass also runs in dev builds.
 * - `dropConsole` is `false` in both, and `treeshake.propertyReadSideEffects` is `'always'`, which is what keeps a
 *   bare property read — `$effect(() => { obj.prop; })`, Svelte's whole dependency-tracking mechanism — from being
 *   optimised away. Both are pinned so a future default flip can't quietly break reactivity.
 * - `target` stays `'esnext'`: Bun's `target: 'browser'` does not downlevel either, and naming a lower level here
 *   would make oxc transpile syntax Bun happily emitted.
 */
const OXC_OPTIONS = {
  compress: { target: 'esnext', dropDebugger: false, dropConsole: false, treeshake: { propertyReadSideEffects: 'always' as const } },
  codegen: { legalComments: 'inline' as const },
};

// Held in a variable so the `import()`s below stay statically unanalysable: an absent optional peer must surface as a
// caught runtime rejection rather than a load-time resolution failure.
const OXC_SPECIFIER = 'oxc-minify';

const INSTALL_HINT = `Install it with \`bun add -d ${OXC_SPECIFIER}\`, or drop \`minifier: 'oxc'\` to stay on Bun's minifier.`;

export interface OxcPackage {
  module: unknown;
  version: unknown;
}

async function loadOxcPackage(): Promise<OxcPackage> {
  const module: unknown = await import(OXC_SPECIFIER);
  const pkg = (await import(`${OXC_SPECIFIER}/package.json`, { with: { type: 'json' } })) as { default?: { version?: unknown }; version?: unknown };
  return { module, version: pkg.default?.version ?? pkg.version };
}

let oxcPending: Promise<OxcMinifier> | undefined;

/**
 * Resolve `oxc-minify`, throwing with install instructions when it isn't there. Unlike the svelte-shaker add-on this
 * refuses to degrade: an opt-in minifier that quietly wasn't applied would leave a deploy's bundle sizes unexplained.
 */
export async function resolveOxcMinify(load: () => Promise<OxcPackage> = loadOxcPackage): Promise<OxcMinifier> {
  oxcPending ??= (async () => {
    let pkg: OxcPackage;
    try {
      pkg = await load();
    } catch (err) {
      throw new Error(`minifier: 'oxc' needs the optional ${OXC_SPECIFIER} package. ${INSTALL_HINT} (${err instanceof Error ? err.message : String(err)})`);
    }
    const fn = (pkg.module as { minify?: unknown } | null)?.minify;
    if (typeof fn !== 'function') {
      throw new Error(`minifier: 'oxc' loaded ${OXC_SPECIFIER} but it exports no \`minify\` function. ${INSTALL_HINT}`);
    }
    // The version is part of every oxc chunk's file name, so a package that hides it can't be served immutable safely.
    if (typeof pkg.version !== 'string' || pkg.version === '') {
      throw new Error(`minifier: 'oxc' could not read the installed ${OXC_SPECIFIER} version. ${INSTALL_HINT}`);
    }
    logger.info(`Minifying client JS with ${OXC_SPECIFIER} ${pkg.version}`);
    return { minify: fn as OxcMinifyFn, version: pkg.version };
  })();
  try {
    return await oxcPending;
  } catch (err) {
    // A rejected resolution must not be memoized, so installing the peer and rebuilding in a watching dev server works.
    oxcPending = undefined;
    throw err;
  }
}

/** Test-only: drop the memoized resolution so a test can exercise a different loader. */
export function resetOxcMinifyCache(): void {
  oxcPending = undefined;
}

/** Short, stable fingerprint of everything besides Bun's input that decides what the oxc pass prints. */
export function oxcOutputTag(version: string, options: OxcMinifyOptions = { ...OXC_OPTIONS, module: true }): string {
  return new Bun.CryptoHasher('sha256')
    .update(`${version}\0${JSON.stringify(options)}`)
    .digest('hex')
    .slice(0, 8);
}

export type ClientBundleNaming = string | { entry: string; chunk: string };

/**
 * Bun's `[hash]` covers only what Bun printed, and client chunks are served `immutable`, so oxc output gets a literal
 * tag in the name: switching minifier, upgrading `oxc-minify` or changing its options must change every URL. The
 * object form is needed because a string `naming` renames entries only.
 */
export async function clientBundleNaming(minifier: MochiJsMinifier): Promise<ClientBundleNaming> {
  if (minifier !== 'oxc') {
    return '[name]-[hash].[ext]';
  }
  const tag = `o${oxcOutputTag((await resolveOxcMinify()).version)}`;
  return { entry: `[name]-[hash]-${tag}.[ext]`, chunk: `chunk-[hash]-${tag}.[ext]` };
}

export interface MinifiableChunk {
  /** Output file name, used for oxc diagnostics. */
  fileName: string;
  code: string;
}

export interface MinifyChunkOptions {
  /**
   * Parse and optimise as an ES module. Pass `false` for output injected as a **classic** `<script>`, which the browser
   * parses with the script goal — sloppy mode, top-level `this` is `window`. Default: `true`.
   */
  module?: boolean;
}

function formatOxcErrors(fileName: string, errors: OxcError[]): string {
  return errors.map((e) => `  ${fileName} — ${e.message}${e.codeframe ? `\n${e.codeframe}` : ''}`).join('\n');
}

/**
 * Run oxc over every chunk, then return them all at once. Nothing is returned until the whole batch succeeds, so a
 * failure on one chunk can't leave the caller writing a bundle where some files went through oxc and some didn't.
 */
export async function minifyJsChunks(chunks: MinifiableChunk[], opts: MinifyChunkOptions = {}): Promise<string[]> {
  if (chunks.length === 0) {
    return [];
  }
  const module = opts.module ?? true;
  const { minify } = await resolveOxcMinify();
  const results = await Promise.all(chunks.map(async (chunk) => ({ chunk, result: await minify(chunk.fileName, chunk.code, { ...OXC_OPTIONS, module }) })));

  const failures = results.filter(({ result }) => result.errors.some((e) => e.severity === 'Error'));
  if (failures.length > 0) {
    throw new Error(`oxc-minify failed on ${failures.length} chunk(s):\n${failures.map(({ chunk, result }) => formatOxcErrors(chunk.fileName, result.errors)).join('\n')}`);
  }
  for (const { chunk, result } of results) {
    for (const warning of result.errors) {
      logger.warn(`oxc-minify ${chunk.fileName}: ${warning.message}`);
    }
  }
  return results.map(({ result }) => result.code);
}

/**
 * Re-minify a finished `Bun.build`'s JS chunks with oxc, keyed by artifact path so the caller can swap each one into
 * whatever it already keeps them in. Returns `null` for the default `'bun'` mode, and leaves CSS and assets alone.
 */
export async function minifyBuildOutputs(outputs: BuildArtifact[], minifier: MochiJsMinifier, opts: MinifyChunkOptions = {}): Promise<Map<string, string> | null> {
  if (minifier !== 'oxc') {
    return null;
  }
  // oxc strips Bun's `//# sourceMappingURL` and its map would point at Bun's output rather than the sources, so a
  // sourcemap here would ship broken; no browser build asks for one today.
  const mapped = outputs.find((o) => o.kind === 'sourcemap' || o.sourcemap);
  if (mapped) {
    throw new Error(`minifier: 'oxc' does not support source maps, but the build emitted one for ${path.basename(mapped.path)}.`);
  }
  const targets = outputs.filter((o) => (o.kind === 'entry-point' || o.kind === 'chunk') && o.path.endsWith('.js'));
  const chunks = await Promise.all(targets.map(async (o) => ({ fileName: path.basename(o.path), code: await o.text() })));
  const minified = await minifyJsChunks(chunks, opts);
  return new Map(targets.map((artifact, i) => [artifact.path, minified[i]!]));
}
