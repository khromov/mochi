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
import type { BuildArtifact } from 'bun';
import { logger } from '../utils/log';

export type MochiJsMinifier = 'bun' | 'oxc';

export const DEFAULT_JS_MINIFIER: MochiJsMinifier = 'bun';

export function isJsMinifier(value: unknown): value is MochiJsMinifier {
  return value === 'bun' || value === 'oxc';
}

const MINIFIER_ENV_VAR = 'MOCHI_MINIFIER';
const envWarned = new Set<string>();

/**
 * `MOCHI_MINIFIER` wins over the configured value, mirroring `MOCHI_SVELTE_COMPILER`, so the two modes can be A/B'd
 * without editing code — including in dev, which has no build CLI to pass a flag to. An unrecognised value is treated
 * as a typo: warn once (a dev server resolves this on every rebuild) and keep the configured choice.
 */
export function resolveMinifierChoice(configured: MochiJsMinifier | undefined): MochiJsMinifier {
  const env = process.env[MINIFIER_ENV_VAR];
  if (isJsMinifier(env)) {
    return env;
  }
  if (env && !envWarned.has(env)) {
    envWarned.add(env);
    logger.warn(`${MINIFIER_ENV_VAR}=${JSON.stringify(env)} is not a known minifier ('bun' | 'oxc') — ignoring.`);
  }
  return configured ?? DEFAULT_JS_MINIFIER;
}

interface OxcSourceMap {
  file?: string;
  mappings: string;
  names: string[];
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: string[];
  version: number;
}

interface OxcError {
  severity: 'Error' | 'Warning' | 'Advice';
  message: string;
  codeframe: string | null;
}

interface OxcMinifyResult {
  code: string;
  map?: OxcSourceMap;
  errors: OxcError[];
}

interface OxcMinifyOptions {
  module?: boolean;
  sourcemap?: boolean;
  compress?: { target?: string; dropDebugger?: boolean; dropConsole?: boolean; treeshake?: { propertyReadSideEffects?: boolean | 'always' } };
  codegen?: { legalComments?: 'none' | 'inline' | 'eof' };
}

type OxcMinifyFn = (filename: string, sourceText: string, options?: OxcMinifyOptions) => Promise<OxcMinifyResult>;

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

// Held in variables so the `import()`s below stay statically unanalysable: an absent optional peer must surface as a
// caught runtime rejection rather than a load-time resolution failure.
const OXC_SPECIFIER = 'oxc-minify';
const REMAPPING_SPECIFIER = '@jridgewell/remapping';

const INSTALL_HINT = `Install it with \`bun add -d ${OXC_SPECIFIER}\`, or drop \`minifier: 'oxc'\` to stay on Bun's minifier.`;

let oxcPending: Promise<OxcMinifyFn> | undefined;

/**
 * Resolve `oxc-minify`, throwing with install instructions when it isn't there. Unlike the svelte-shaker add-on this
 * refuses to degrade: an opt-in minifier that quietly wasn't applied would leave a deploy's bundle sizes unexplained.
 */
export async function resolveOxcMinify(load: () => Promise<unknown> = () => import(OXC_SPECIFIER)): Promise<OxcMinifyFn> {
  oxcPending ??= (async () => {
    let mod: unknown;
    try {
      mod = await load();
    } catch (err) {
      throw new Error(`minifier: 'oxc' needs the optional ${OXC_SPECIFIER} package. ${INSTALL_HINT} (${err instanceof Error ? err.message : String(err)})`);
    }
    const fn = (mod as { minify?: unknown } | null)?.minify;
    if (typeof fn !== 'function') {
      throw new Error(`minifier: 'oxc' loaded ${OXC_SPECIFIER} but it exports no \`minify\` function. ${INSTALL_HINT}`);
    }
    return fn as OxcMinifyFn;
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

export interface MinifiableChunk {
  /** Output file name, used for oxc diagnostics and as the sourcemap's `file`. */
  fileName: string;
  code: string;
  /** Bun's own map for this chunk, as raw JSON, when the build emitted one. */
  map?: string;
}

export interface MinifiedChunk {
  code: string;
  /** Present only when the input carried a map; already remapped onto the original sources. */
  map?: string;
}

export interface MinifyChunkOptions {
  /**
   * Parse and optimise as an ES module. Pass `false` for output injected as a **classic** `<script>`: in script mode
   * oxc leaves top-level bindings un-mangled and un-dropped, which a classic script needs because its top-level
   * declarations are observable globals — renaming them to one-letter names invites a `SyntaxError` against another
   * classic script's bindings, and dropping an "unused" one deletes a global. Default: `true`.
   */
  module?: boolean;
}

/**
 * A classic `<script>` cannot run `import`/`export`, and oxc's script mode parses them anyway rather than rejecting
 * them, so the guard has to be explicit: anything module-shaped reaching this path would be a `SyntaxError` on every
 * page load, which is worth failing the build over.
 */
export function assertNoModuleSyntax(fileName: string, code: string): void {
  const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(code);
  const statics = imports.filter((i) => i.kind !== 'dynamic-import');
  if (statics.length > 0 || exports.length > 0) {
    throw new Error(
      `${fileName} is injected as a classic <script> but still contains module syntax ` +
        `(${statics.length} import(s), ${exports.length} export(s)) — it would be a SyntaxError in the browser.`,
    );
  }
}

function formatOxcErrors(fileName: string, errors: OxcError[]): string {
  return errors.map((e) => `  ${fileName} — ${e.message}${e.codeframe ? `\n${e.codeframe}` : ''}`).join('\n');
}

/**
 * Run oxc over every chunk, then return them all at once. Nothing is returned until the whole batch succeeds, so a
 * failure on one chunk can't leave the caller writing a bundle where some files went through oxc and some didn't.
 */
export async function minifyJsChunks(chunks: MinifiableChunk[], opts: MinifyChunkOptions = {}): Promise<MinifiedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }
  const module = opts.module ?? true;
  const minify = await resolveOxcMinify();
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const wantsMap = chunk.map !== undefined;
      const result = await minify(chunk.fileName, chunk.code, { ...OXC_OPTIONS, module, sourcemap: wantsMap });
      return { chunk, result };
    }),
  );

  const failures = results.filter(({ result }) => result.errors.some((e) => e.severity === 'Error'));
  if (failures.length > 0) {
    throw new Error(`oxc-minify failed on ${failures.length} chunk(s):\n${failures.map(({ chunk, result }) => formatOxcErrors(chunk.fileName, result.errors)).join('\n')}`);
  }
  for (const { chunk, result } of results) {
    for (const warning of result.errors) {
      logger.warn(`[mochi] oxc-minify ${chunk.fileName}: ${warning.message}`);
    }
  }

  return Promise.all(
    results.map(async ({ chunk, result }): Promise<MinifiedChunk> => {
      if (chunk.map === undefined) {
        return { code: result.code };
      }
      if (!result.map) {
        return { code: result.code, map: chunk.map };
      }
      return { code: result.code, map: await chainSourceMap(chunk.fileName, chunk.map, result.map) };
    }),
  );
}

/**
 * Re-minify a finished `Bun.build`'s JS chunks with oxc, keyed by artifact path so the caller can swap each one into
 * whatever it already keeps them in. Returns `null` for the default `'bun'` mode, and leaves CSS, assets and any
 * non-JS output alone. A chunk's sourcemap artifact appears in the map too, remapped onto the original sources.
 */
export async function minifyBuildOutputs(outputs: BuildArtifact[], minifier: MochiJsMinifier, opts: MinifyChunkOptions = {}): Promise<Map<string, string> | null> {
  if (minifier !== 'oxc') {
    return null;
  }
  const targets = outputs.filter((o) => (o.kind === 'entry-point' || o.kind === 'chunk') && o.path.endsWith('.js'));
  const chunks: MinifiableChunk[] = await Promise.all(
    targets.map(async (o) => ({
      fileName: basename(o.path),
      code: await o.text(),
      ...(o.sourcemap ? { map: await o.sourcemap.text() } : {}),
    })),
  );
  const minified = await minifyJsChunks(chunks, opts);
  const byPath = new Map<string, string>();
  for (const [i, artifact] of targets.entries()) {
    const result = minified[i]!;
    byPath.set(artifact.path, result.code);
    if (artifact.sourcemap && result.map !== undefined) {
      byPath.set(artifact.sourcemap.path, result.map);
    }
  }
  return byPath;
}

// Bun artifact paths are always `/`-joined regardless of platform, so a POSIX basename is enough and avoids importing
// `node:path` into a module the browser-facing build graph can reach.
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * oxc's map goes minified → bundler output; chaining it through the bundler's own map is what keeps the result
 * pointing at the original `.svelte`/`.ts` sources rather than at Bun's intermediate chunk.
 */
async function chainSourceMap(fileName: string, bundlerMapJson: string, oxcMap: OxcSourceMap): Promise<string> {
  let remapping: (map: unknown, loader: (file: string) => unknown) => unknown;
  try {
    const mod = (await import(REMAPPING_SPECIFIER)) as { default?: unknown; remapping?: unknown };
    remapping = (mod.default ?? mod.remapping) as typeof remapping;
  } catch (err) {
    throw new Error(
      `minifier: 'oxc' needs the optional ${REMAPPING_SPECIFIER} package to keep source maps pointing at the original sources. ` +
        `Install it with \`bun add -d ${REMAPPING_SPECIFIER}\`, or turn source maps off. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const bundlerMap = JSON.parse(bundlerMapJson) as OxcSourceMap;
  let served = false;
  const chained = remapping({ ...oxcMap, file: fileName }, () => {
    // The loader is asked for every source the outer map names; only oxc's single synthetic source — the bundler's own
    // output — has a map to descend into, and it is offered exactly once.
    if (served) {
      return null;
    }
    served = true;
    return bundlerMap;
  });
  return JSON.stringify(chained);
}
