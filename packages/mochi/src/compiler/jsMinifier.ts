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

type OxcMinifyFn = (filename: string, sourceText: string, options?: { module?: boolean; sourcemap?: boolean }) => Promise<OxcMinifyResult>;

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

function formatOxcErrors(fileName: string, errors: OxcError[]): string {
  return errors.map((e) => `  ${fileName} — ${e.message}${e.codeframe ? `\n${e.codeframe}` : ''}`).join('\n');
}

/**
 * Run oxc over every chunk, then return them all at once. Nothing is returned until the whole batch succeeds, so a
 * failure on one chunk can't leave the caller writing a bundle where some files went through oxc and some didn't.
 */
export async function minifyJsChunks(chunks: MinifiableChunk[]): Promise<MinifiedChunk[]> {
  if (chunks.length === 0) {
    return [];
  }
  const minify = await resolveOxcMinify();
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const wantsMap = chunk.map !== undefined;
      const result = await minify(chunk.fileName, chunk.code, { module: true, sourcemap: wantsMap });
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
export async function minifyBuildOutputs(outputs: BuildArtifact[], minifier: MochiJsMinifier): Promise<Map<string, string> | null> {
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
  const minified = await minifyJsChunks(chunks);
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
