/**
 * Manual chunk control for the island client bundle: `Mochi.serve({ clientBundle: { chunks } })`.
 *
 * Bun's bundler has no `manualChunks` equivalent — it assigns a module to a chunk purely by the set of entrypoints
 * that reach it, and two modules share a chunk only when those sets match exactly. So the grouping is induced rather
 * than configured: each assigned module is replaced, at its import sites, by a generated *view* that re-exports it and
 * links into a ring through the group's other views. Reaching any member therefore reaches all of them, which equalizes
 * their reachability sets and collapses the group into one output.
 *
 * These views are deliberately not entrypoints. Bun pins an entrypoint file into its own entry chunk while bucketing
 * its dependencies by reachability, so an entrypoint here emits a near-empty named file plus a separate fat chunk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toPosixPath } from '../utils/index';
import type { MochiChunkClassifier, MochiClientBundleOptions } from '../types';

/** Plugin namespace holding the generated view modules. */
export const CHUNK_NAMESPACE = 'mochi-chunk';

const VIEW_PREFIX = 'view:';

/** Chunk names become part of build output and reporting, so keep them to filename-safe characters. */
const VALID_CHUNK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Names Mochi already uses for its own entries and outputs. */
const RESERVED_CHUNK_NAMES = new Set(['chunk', 'stats']);

/** Packages whose module initialization order cannot survive being relocated. See the skip in `classifyModules`. */
const PROTECTED_PACKAGES = new Set(['svelte']);

const STORE_PATH = /^(?:\.\.\/)*node_modules\/\.bun\/[^/]+\/node_modules\/(.+)$/;
const LEADING_NODE_MODULES = /^(?:\.\.\/)*node_modules\//;

/**
 * An absolute path that has been resolved against a base and normalized to forward slashes — the form every map in this
 * module is keyed by.
 *
 * The brand exists because the resolved form is platform-dependent at the root (`/app/x.ts` on POSIX,
 * `C:/app/x.ts` on Windows) while looking like any other string. Writing a key as a literal type-checks, matches
 * locally, and then misses on Windows only. Requiring `posixAbs()` to mint one makes that mistake a compile error.
 */
export type PosixAbsPath = string & { readonly __posixAbs: unique symbol };

/** The only way to mint a {@link PosixAbsPath}. */
export function posixAbs(p: string, cwd: string = process.cwd()): PosixAbsPath {
  return toPosixPath(path.resolve(cwd, p)) as PosixAbsPath;
}

export const viewId = (absPath: PosixAbsPath): string => `${VIEW_PREFIX}${absPath}`;

/** Minimal shape this module reads out of `Bun.build`'s metafile, so tests can build literals instead of running a build. */
export interface ChunkMetafile {
  inputs: Record<string, { bytes: number; format?: string }>;
  outputs?: Record<string, { inputs: Record<string, unknown> }>;
}

/**
 * Pass 1's module evaluation order, keyed by absolute POSIX path.
 *
 * Bun lists an output's inputs in the order it concatenated them, which is the order the browser would have run them —
 * the only record of the ungrouped initialization sequence, since the input map is in parse order instead. Outputs are
 * walked in sorted path order so two members that pass 1 put in different chunks still rank deterministically; their
 * relative order was never observable anyway, whereas co-located members keep exactly the order they had.
 */
export function evaluationOrder(metafile: ChunkMetafile, cwd: string = process.cwd()): Map<PosixAbsPath, number> {
  const order = new Map<PosixAbsPath, number>();
  for (const outPath of Object.keys(metafile.outputs ?? {}).sort()) {
    for (const input of Object.keys(metafile.outputs![outPath]!.inputs)) {
      const id = posixAbs(input, cwd);
      if (!order.has(id)) {
        order.set(id, order.size);
      }
    }
  }
  return order;
}

const SCANNABLE_LOADERS: Record<string, 'js' | 'jsx' | 'ts' | 'tsx'> = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
};

/** Compiled by a loader later in the build; every one of them has a default export and no other statically known name. */
const ALWAYS_DEFAULT_EXTENSIONS = new Set(['.svelte', '.md', '.svx']);

/**
 * Whether a view needs an explicit `export { default } from`, or `null` when that can't be determined ahead of the
 * build and the module must be left alone.
 *
 * A view re-exports its module with `export *`, which carries every named export — including ones the module itself
 * re-exports from elsewhere — but never `default`. So the default is the only name that has to be decided up front.
 */
export function hasDefaultExport(absPath: string, readFile: (p: string) => string): boolean | null {
  const ext = path.extname(absPath).toLowerCase();
  if (ALWAYS_DEFAULT_EXTENSIONS.has(ext)) {
    return true;
  }
  const loader = SCANNABLE_LOADERS[ext];
  if (!loader) {
    return null;
  }
  try {
    return new Bun.Transpiler({ loader }).scan(readFile(absPath)).exports.includes('default');
  } catch {
    return null;
  }
}

export interface ChunkPlan {
  /** Chunk name → absolute POSIX paths of every module assigned to it. */
  members: Map<string, PosixAbsPath[]>;
  /** Absolute POSIX path → the chunk it belongs to. */
  chunkOf: Map<PosixAbsPath, string>;
  /** Virtual module id → generated source. */
  sources: Map<string, string>;
}

/**
 * Strip Bun's `node_modules/` and isolated-store `node_modules/.bun/<pkg>@<ver>/node_modules/` prefixes so an id reads
 * the same under either linker. Mirrors `bundleInputPaths.cleanInputPath`, but that one is display-oriented and lossy,
 * so it must not be reused as an identity.
 */
export function packageNameOf(posixId: string): string | null {
  const rel = posixId.replace(/^.*?(?=(?:\.\.\/)*node_modules\/)/, '');
  const store = rel.match(STORE_PATH);
  const stripped = store ? store[1]! : LEADING_NODE_MODULES.test(rel) ? rel.replace(LEADING_NODE_MODULES, '') : null;
  if (stripped === null) {
    return null;
  }
  const seg = stripped.split('/');
  return stripped.startsWith('@') ? seg.slice(0, 2).join('/') : (seg[0] ?? null);
}

export function validateClientBundleOptions(opts: unknown): MochiClientBundleOptions | undefined {
  if (opts === undefined || opts === null) {
    return undefined;
  }
  if (typeof opts !== 'object' || Array.isArray(opts)) {
    throw new Error(`[mochi] clientBundle must be an object with optional "chunks" / "splitting", received ${Array.isArray(opts) ? 'array' : typeof opts}.`);
  }
  const o = opts as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== 'chunks' && key !== 'splitting') {
      throw new Error(`[mochi] Unknown clientBundle option "${key}". Supported: chunks, splitting.`);
    }
  }
  if (o.chunks !== undefined && typeof o.chunks !== 'function') {
    throw new Error(`[mochi] clientBundle.chunks must be a function (id, ctx) => string | null, received ${typeof o.chunks}.`);
  }
  if (o.splitting !== undefined && typeof o.splitting !== 'boolean') {
    throw new Error(`[mochi] clientBundle.splitting must be a boolean, received ${typeof o.splitting}.`);
  }
  // Shared chunks are what splitting emits, so the pair is self-contradictory: the classifier would run, cost a second
  // full build pass, and produce nothing — while the build report named island entries as if they were chunks.
  if (o.chunks !== undefined && o.splitting === false) {
    throw new Error('[mochi] clientBundle.chunks needs clientBundle.splitting — with splitting disabled Bun emits no shared chunks for it to fill. Drop one of the two.');
  }
  return opts as MochiClientBundleOptions;
}

function assertValidChunkName(name: string, relId: string): void {
  if (name.trim() === '') {
    throw new Error(`[mochi] clientBundle.chunks returned an empty chunk name for "${relId}" — return a non-empty name or null.`);
  }
  if (!VALID_CHUNK_NAME.test(name)) {
    throw new Error(
      `[mochi] Invalid chunk name ${JSON.stringify(name)} from clientBundle.chunks for "${relId}" — ` +
        `chunk names may contain letters, digits, ".", "_" and "-", and must start with a letter or digit.`,
    );
  }
  if (RESERVED_CHUNK_NAMES.has(name)) {
    throw new Error(`[mochi] Chunk name ${JSON.stringify(name)} is reserved by Mochi (from clientBundle.chunks for "${relId}") — pick another name.`);
  }
}

/**
 * Run the user classifier over every real source file in the client graph.
 *
 * Virtual modules are filtered out by an existence check rather than a name list, so the framework's own
 * `mochi-env:` / `mochi-server-only:` namespaces and the synthetic `_hydrate-*.js` entries are all excluded without
 * this module needing to know about any of them.
 *
 * Anything the classifier picks but that cannot be moved safely is collected in `skipped` for the build report rather
 * than dropped quietly, since a silent skip reads as "it worked".
 */
export function classifyModules(
  metafile: ChunkMetafile,
  classify: MochiChunkClassifier,
  opts: { entrypoints?: Set<PosixAbsPath>; cwd?: string; readFile?: (p: string) => string } = {},
): { chunkOf: Map<PosixAbsPath, string>; skipped: { id: string; reason: string }[]; defaultOf: Map<PosixAbsPath, boolean> } {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const defaultOf = new Map<PosixAbsPath, boolean>();
  const entrypoints = opts.entrypoints ?? new Set<PosixAbsPath>();
  const chunkOf = new Map<PosixAbsPath, string>();
  const skipped: { id: string; reason: string }[] = [];

  for (const [rawId, meta] of Object.entries(metafile.inputs)) {
    const id = posixAbs(rawId, cwd);
    if (entrypoints.has(id) || !fs.existsSync(id)) {
      continue;
    }
    const relativeId = toPosixPath(path.relative(cwd, id));
    const packageName = packageNameOf(id);
    let picked: string | null | undefined;
    try {
      picked = classify(id, { isNodeModules: packageName !== null, packageName, relativeId, bytes: meta.bytes });
    } catch (err) {
      throw new Error(`[mochi] clientBundle.chunks threw while classifying "${relativeId}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (picked === null || picked === undefined) {
      continue;
    }
    if (typeof picked !== 'string') {
      throw new Error(`[mochi] clientBundle.chunks returned ${JSON.stringify(picked)} for "${relativeId}" — ` + `return a chunk name string, or null to leave placement to Bun.`);
    }
    assertValidChunkName(picked, relativeId);
    // A CJS module's exports are synthesized during bundling, so neither `export *` nor an up-front default check sees
    // them; a view would silently re-export nothing.
    if (meta.format === 'cjs') {
      skipped.push({ id: relativeId, reason: 'CommonJS, whose exports are synthesized during bundling' });
      continue;
    }
    // Svelte's runtime is densely circular, and moving its modules reorders their initialization: the build still
    // succeeds while the browser throws on hydration. There is nothing to win either way — every island entry reaches
    // the runtime, so Bun already emits it as a single shared chunk.
    if (packageName !== null && PROTECTED_PACKAGES.has(packageName)) {
      skipped.push({ id: relativeId, reason: `the ${packageName} runtime, already one shared chunk and unsafe to reorder` });
      continue;
    }
    const hasDefault = hasDefaultExport(id, readFile);
    if (hasDefault === null) {
      skipped.push({ id: relativeId, reason: `unreadable ${path.extname(id) || 'source'}` });
      continue;
    }
    defaultOf.set(id, hasDefault);
    chunkOf.set(id, picked);
  }
  return { chunkOf, skipped, defaultOf };
}

/**
 * Build the view sources for an assignment.
 *
 * Each member gets a view that star-re-exports the real module and side-effect-imports the *next* view in the group,
 * closing into a ring. Reaching any one view therefore walks the ring and reaches every member, which equalizes their
 * entrypoint reachability and is what collapses the group into a single chunk. A ring rather than every-imports-every
 * keeps this linear: a 250-module group emits 250 extra imports instead of ~62,000.
 *
 * Grouping hoists the whole group to wherever its first member was reached, so the members' order relative to each
 * other is all that can be preserved — and it is, by two things together. The re-export is emitted *before* the ring
 * import, so a view runs its own module before walking on; a ring import first would evaluate the group backwards.
 * And `order` (pass 1's evaluation order, via `evaluationOrder`) lays the ring out in the sequence the modules already
 * ran in, so whichever member is reached first walks the rest in their original order.
 *
 * `export *` carries every named export the module has, including ones it re-exports from elsewhere, so no export list
 * has to be computed ahead of the build. It never carries `default`, which is why that one name is passed in.
 */
export function planChunks(chunkOf: Map<PosixAbsPath, string>, hasDefault: (absPath: PosixAbsPath) => boolean, order?: ReadonlyMap<PosixAbsPath, number>): ChunkPlan {
  const members = new Map<string, PosixAbsPath[]>();
  for (const [id, chunk] of chunkOf) {
    const list = members.get(chunk);
    if (list) {
      list.push(id);
    } else {
      members.set(chunk, [id]);
    }
  }
  // Evaluation order first, path as the tie-break, so one config plans identically across runs and output hashes stay
  // stable even for members pass 1 never placed together.
  const rank = (id: PosixAbsPath) => order?.get(id) ?? Number.MAX_SAFE_INTEGER;
  for (const list of members.values()) {
    list.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  }

  const sources = new Map<string, string>();
  for (const list of members.values()) {
    list.forEach((m, i) => {
      const quoted = JSON.stringify(m);
      const lines: string[] = [`export * from ${quoted};`];
      if (hasDefault(m)) {
        lines.push(`export { default } from ${quoted};`);
      }
      const next = list[(i + 1) % list.length]!;
      if (next !== m) {
        lines.push(`import ${JSON.stringify(viewId(next))};`);
      }
      sources.set(viewId(m), lines.join('\n'));
    });
  }
  return { members, chunkOf, sources };
}

/**
 * A filter matching any specifier that *might* resolve to an assigned module.
 *
 * An `onResolve` whose filter matches one of the in-memory `files:` entrypoints the island bundle is built from makes
 * Bun stop resolving it entirely, failing the build with `ModuleNotFound … (entry point)` — even when the handler
 * returns `undefined` for everything. Hence both halves here: a cheap superset (file stem plus containing directory
 * name, so `./lib` resolving to `lib/index.ts` is covered) and an explicit exclusion of the entry names.
 *
 * A specifier that slips past degrades gracefully: the module keeps Bun's own placement instead of being mis-assigned.
 */
export function chunkResolveFilter(chunkOf: Map<PosixAbsPath, string>, virtualEntryNames: Iterable<string> = []): RegExp {
  // The generated view specifiers have to match too, since one handler serves both directions.
  const stems = new Set<string>([VIEW_PREFIX]);
  for (const abs of chunkOf.keys()) {
    stems.add(path.basename(abs, path.extname(abs)));
    stems.add(path.basename(abs));
    stems.add(path.basename(path.dirname(abs)));
  }
  const alternation = [...stems]
    .filter((s) => s.length > 0)
    .sort()
    .map(escapeRegex)
    .join('|');
  // No members means the caller shouldn't have asked; match nothing rather than everything.
  if (alternation === '') {
    return /(?!)/;
  }
  // A directory stem like `src` (from `svelte/src/utils.js`) otherwise matches the island entry paths, and an
  // `onResolve` whose filter matches an in-memory `files:` entry stops Bun resolving it at all — even when the handler
  // returns undefined. So entry names are excluded up front rather than inside the handler.
  const guard = [...virtualEntryNames].map(escapeRegex).join('|');
  return new RegExp(`^${guard === '' ? '' : `(?!.*(?:${guard}))`}.*(?:${alternation})`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Absolute POSIX path a plugin specifier points at, or `null` when it can't be resolved.
 *
 * Chunk membership is keyed on the resolved paths Bun's metafile reports, while `onResolve` sees the raw specifier —
 * usually extensionless (`./vendorOne`), so a bare `path.resolve` would never match `…/vendorOne.ts`. Mirrors the
 * resolve-with-fallback in `serverOnlyComponents.ts`.
 */
export function resolveChunkMember(args: { path: string; importer?: string; resolveDir?: string }): PosixAbsPath | null {
  try {
    return toPosixPath(Bun.resolveSync(args.path, args.resolveDir || (args.importer ? path.dirname(args.importer) : process.cwd()))) as PosixAbsPath;
  } catch {
    if (args.resolveDir) {
      return posixAbs(args.path, args.resolveDir);
    }
    return null;
  }
}

/** True for a generated view id, i.e. a module this planner authored. */
export function isChunkModuleId(id: string | undefined): boolean {
  return !!id && (id.startsWith(VIEW_PREFIX) || id.startsWith(`${CHUNK_NAMESPACE}:`));
}
