import { preprocess as sveltePreprocess, type CompileOptions, type PreprocessorGroup } from 'svelte/compiler';
import { render } from 'svelte/server';
import path from 'node:path';
import fs from 'node:fs';
import type { BunPlugin } from 'bun';
import { isSvelteMarker, normalizeAssetPrefix, normalizeIslandHydrationMarkers, relForDisplay, stripHydrationMarkers, toCompileErrorLogs, toPosixPath } from '../utils';
import { injectIslandPropsBlock } from '../islands/islandPropsRegistry';
import { requestContext, renderDetached } from '../runtime/requestContext';
import type { DebugBarData } from '../runtime/requestContext';
import { logger } from '../utils/log';
import { mochiEvents } from '../events';
import { detectHeavyBarrels, formatBarrelLine, formatBarrelSummary, type BarrelMetafile, type HeavyBarrel } from './barrelDetect';
import type { MarkdownConfig, MochiBarrelWarningOptions, MochiManifest, MochiSvelteShakerOptions } from '../types';
import { type HydratableComponent, type PreprocessIslandError, type ServerIslandComponent } from './svelteAstPreprocess';
import { cachedPreprocessHydratable, createPreprocessCacheStats } from './preprocessCache';
import { CompileCache, compileFingerprint, createCompileCacheStats, type CompileCacheStats } from './compileCache';
import { mergeCompilerOptions, type MochiSvelteConfig } from './svelteConfig';
import { backendId, resolveSvelteCompiler, type MochiSvelteCompiler, type SvelteCompilerBackend } from './svelteCompilerBackend';
import { applyFilter } from '../extensions';
import { buildServerOnlyStubModule, scanServerOnlyExports } from './serverOnlyScan';
import { renderMochiEnvServer, renderMochiEnvClient } from './virtualModuleTemplate';
import { createImageAssetLoader, IMAGE_FILE_FILTER } from './imageAssetLoader';
import { registerLocalImageAsset } from '../image/localAssetRegistry';
import type { LocalImageAsset } from '../image/types';
import { freshImport } from './freshImport';
import { shakeApp } from './svelteShaker';
import prettyBytes from '../vendor/pretty-bytes';

/**
 * Run user-supplied Svelte preprocessors via the `compile:preprocessors`
 * filter. Returns the (possibly transformed) source. The filter is sync — only
 * the application of those preprocessors is async (Svelte's `preprocess()`).
 */
async function applyUserPreprocessors(source: string, filename: string, target: 'server' | 'client', development: boolean): Promise<string> {
  const userPreprocessors: PreprocessorGroup[] = applyFilter('compile:preprocessors', [], {
    filename,
    target,
    development,
  });
  // `builtinTsPreprocessor` runs last so it also strips TS that user
  // preprocessors emit. svelte's `preprocess()` parses the component and hands
  // each hook properly-parsed `attributes` — so it, not a source scan, decides
  // whether a script block is TS.
  //
  // Fast-path: with no user preprocessors, the only work `preprocess()` can do
  // is the builtin TS pass, which fires solely on `attributes.lang === 'ts'`.
  // A `lang="ts"` attribute — in any quoting/spacing — always contains the
  // literal substring `lang`, so a source lacking it provably has no TS script
  // to transpile. This gate can only false-*positive* (harmlessly re-parse a
  // "lang"-containing plain-JS file), never false-negative, so it skips the
  // full-component parse for the common plain-JS case without the brittleness
  // of a tag-matching regex. Any user preprocessor may inject TS, so the gate
  // holds only when none are registered.
  if (userPreprocessors.length === 0 && !source.includes('lang')) {
    return source;
  }
  const result = await sveltePreprocess(source, [...userPreprocessors, builtinTsPreprocessor], { filename });
  return result.code;
}

// Svelte 5's native TS stripping is incomplete (e.g. it throws on constructor
// parameter properties). Run Bun's transpiler over <script lang="ts"> before
// svelte/compiler — the same treatment the .svelte.[jt]s rune-module loaders
// already apply. transformSync does NOT tree-shake, so value imports referenced
// only in the template survive.
const tsScriptTranspiler = new Bun.Transpiler({ loader: 'ts' });
const builtinTsPreprocessor: PreprocessorGroup = {
  name: 'mochi-ts',
  script({ content, attributes }) {
    if (attributes.lang !== 'ts') {
      return;
    }
    // `lang="ts"` must STAY on the tag: it also puts the template in TS mode
    // (snippet parameter types, `as` casts in markup), which Bun never sees —
    // dropping it makes svelte parse those as plain JS and fail. Re-running
    // svelte's native TS pass over the already-transpiled script is a no-op.
    // transformSync can't emit a source map, so positions after a transpiled
    // script drift by its reprinted line-count delta — a limitation shared
    // with the .svelte.[jt]s rune-module loaders.
    return { code: tsScriptTranspiler.transformSync(content) };
  },
};

/**
 * Directory containing the framework's own .ts/.svelte source files. This file
 * lives in `src/compiler/`, so climb one level: every path built from SRC_DIR
 * below is expressed relative to `src/`, matching the layout on disk and in the
 * published package.
 */
const SRC_DIR = path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

/** Manifest schema version this runtime writes. v2 made every artifact path out-dir-relative. */
const MANIFEST_VERSION = 2;

// TODO
// Bun's CSS bundler unquotes `format('woff2-variations')` to `format(woff2-variations)`,
// which is invalid CSS — only the seven plain keywords (woff2, woff, truetype, opentype,
// embedded-opentype, svg, collection) work bare. Browsers silently drop the src and the
// font never loads. Re-quote the four compound `*-variations` hints back to strings.
const VARIATION_FORMAT_RE = /\bformat\((woff2-variations|woff-variations|truetype-variations|opentype-variations)\)/g;
function restoreVariationsFormat(css: string): string {
  return css.replace(VARIATION_FORMAT_RE, "format('$1')");
}

/**
 * Format a `Bun.build()` failure's `logs` array as a multi-line string with
 * `file:line:column — message` per entry. Bun 1.2+ throws a generic
 * `AggregateError("Bundle failed")` with `stack === undefined` on its own,
 * which loses the per-message position info — we always pass `throw: false`
 * to recover the structured logs and run them through this helper instead.
 */
export function formatBuildMessages(
  logs: ReadonlyArray<{
    message: string;
    position?: { file: string; line: number; column: number } | null;
  }>,
): string {
  if (logs.length === 0) {
    return '  <no diagnostic messages>';
  }
  const formatted = logs
    .map((l) => {
      const p = l.position;
      const where = p ? `${relForDisplay(p.file)}:${p.line}:${p.column}` : '<unknown>';
      return `  ${where} — ${l.message}`;
    })
    .join('\n');

  // A read failure on a file inside the isolated linker's node_modules/.bun
  // symlink store is the signature of a known Bun bug (a second Bun.build in a
  // `bun test` / --hot / --watch process fails reading deps the runtime loader
  // already imported). Without this hint the error looks like a broken dep and
  // costs hours; with it the fix is a two-line bunfig change.
  if (/reading file/.test(formatted) && /node_modules[\\/]\.bun[\\/]/.test(formatted)) {
    return (
      `${formatted}\n` +
      `  hint: this matches a known Bun bug — a second Bun.build() inside \`bun test\` (or --hot/--watch)\n` +
      `  fails reading node_modules files resolved through the isolated linker's symlinked\n` +
      `  node_modules/.bun store. Fix: add \`linker = "hoisted"\` under \`[install]\` in bunfig.toml,\n` +
      `  delete node_modules, and reinstall. See https://github.com/khromov/bun-second-build-eisdir-repro`
    );
  }
  return formatted;
}

const MARKDOWN_EXTENSIONS = ['.md', '.svx'];
const MARKDOWN_FILE_FILTER = /\.(md|svx)$/;

function createMarkdownLoader(opts: {
  markdown: MarkdownConfig;
  target: 'server' | 'client';
  development: boolean;
  cssMap?: Map<string, string>;
  userCompilerOptions: CompileOptions;
  backend: SvelteCompilerBackend;
  compileCache: CompileCache;
  compileCacheStats?: CompileCacheStats;
  hydration?: {
    fileHydratables: Map<string, HydratableComponent[]>;
    allHydratables: HydratableComponent[];
    allServerIslands: ServerIslandComponent[];
    filePreprocessErrors: Map<string, PreprocessIslandError[]>;
    preprocessCacheStats: ReturnType<typeof createPreprocessCacheStats>;
  };
}) {
  const highlight = opts.markdown.highlight;
  const fingerprint = compileFingerprint(opts.userCompilerOptions, opts.development, backendId(opts.backend));
  return async (args: { path: string }) => {
    const raw = await Bun.file(args.path).text();
    // Cache hit: replay the side effects (hydration metadata, scoped CSS) the
    // miss path would have produced and skip mdsvex + svelte compile entirely.
    // Keyed on raw source, so this assumes mdsvex + the user preprocessors are
    // pure in (source, filename): a plugin that reads an *external* file (e.g. a
    // sibling .json) won't re-run until this file's own bytes change or the
    // config reloads — the standard Vite/SvelteKit preprocessor contract.
    const cached = opts.compileCache.get(opts.target, args.path, raw, fingerprint, opts.compileCacheStats);
    if (cached) {
      if (opts.hydration) {
        opts.hydration.fileHydratables.set(args.path, cached.hydratables);
        opts.hydration.allHydratables.push(...cached.hydratables);
        opts.hydration.allServerIslands.push(...cached.serverIslands);
        opts.hydration.filePreprocessErrors.set(args.path, cached.preprocessErrors);
      }
      if (opts.target === 'server' && cached.css && opts.cssMap) {
        opts.cssMap.set(args.path, cached.css);
      }
      return { contents: cached.js, loader: 'js' as const };
    }
    // mdsvex's `compile` declares a nested-Promise return type, so we accept
    // `unknown` at the type level and await + validate at runtime. `await`
    // flattens any thenable chain to the eventual `{ code; … } | undefined`.
    const compiled = (await opts.markdown.compile(raw, {
      filename: args.path,
      extensions: MARKDOWN_EXTENSIONS,
      rehypePlugins: opts.markdown.rehypePlugins,
      remarkPlugins: opts.markdown.remarkPlugins,
      highlight,
    })) as { code?: unknown } | undefined;
    if (!compiled || typeof compiled.code !== 'string') {
      throw new Error(`markdown.compile returned no output for ${args.path}`);
    }
    // mdsvex passes <script lang="ts"> through untouched, so its output needs
    // the same built-in TS pass as regular .svelte files. User preprocessors
    // still don't apply here — mdsvex owns markdown transforms. Same safe
    // `lang` fast-path as applyUserPreprocessors: no `lang` substring → no TS
    // script → skip the parse (can't false-negative).
    let svelteSource = compiled.code.includes('lang') ? (await sveltePreprocess(compiled.code, [builtinTsPreprocessor], { filename: args.path })).code : compiled.code;
    let hydratables: HydratableComponent[] = [];
    let serverIslands: ServerIslandComponent[] = [];
    let preprocessErrors: PreprocessIslandError[] = [];
    if (opts.hydration) {
      const preprocessed = cachedPreprocessHydratable(svelteSource, args.path, opts.hydration.preprocessCacheStats);
      hydratables = preprocessed.hydratables;
      serverIslands = preprocessed.serverIslands;
      preprocessErrors = preprocessed.errors;
      opts.hydration.fileHydratables.set(args.path, hydratables);
      opts.hydration.allHydratables.push(...hydratables);
      opts.hydration.allServerIslands.push(...serverIslands);
      opts.hydration.filePreprocessErrors.set(args.path, preprocessErrors);
      svelteSource = preprocessed.transformed;
    }
    const { js, css } = opts.backend.compile(
      svelteSource,
      mergeCompilerOptions(opts.userCompilerOptions, {
        generate: opts.target,
        filename: args.path,
        ...(opts.target === 'client' ? { dev: opts.development } : {}),
      }),
    );
    const cssCode = opts.target === 'server' ? (css?.code ?? null) : null;
    if (cssCode && opts.cssMap) {
      opts.cssMap.set(args.path, cssCode);
    }
    opts.compileCache.set(opts.target, args.path, raw, fingerprint, { js: js.code, css: cssCode, hydratables, serverIslands, preprocessErrors });
    return { contents: js.code, loader: 'js' as const };
  };
}

export type MochiCompileError =
  | {
      kind: 'nested-hydration';
      parent: string;
      child: string;
      parentPath: string;
      childPath: string;
    }
  | {
      kind: 'css-bundle-failed';
      cssPath: string;
      message: string;
    }
  | {
      kind: 'unresolved-island';
      component: string;
      directive: string;
      filePath: string;
      importSource: string | null;
    };

function formatUnresolvedIsland(e: Extract<MochiCompileError, { kind: 'unresolved-island' }>): string {
  const where = relForDisplay(e.filePath);
  const head = `Unresolved island: <${e.component} ${e.directive}> in ${where}`;
  if (e.importSource === null) {
    return (
      `${head} — "${e.component}" has no matching import. mochi:* directives need a static relative import of a ` +
      `.svelte/.md/.svx file in this file's <script> (e.g. \`import ${e.component} from './${e.component}.svelte'\`). ` +
      `A component received via props or a variable can't be an island — wrap it in a local .svelte component and put the directive there.`
    );
  }
  const why = e.importSource.startsWith('.')
    ? `its import of "${e.importSource}" is not a form islands support (a default or named import of a relative .svelte/.md/.svx path)`
    : `"${e.importSource}" is a third-party package import, which mochi:* directives don't support (the framework's own \`mochi-framework/components\` are the exception and work directly)`;
  return `${head} — ${why}. Wrap the component in a local .svelte file (e.g. a component that renders <${e.component} … />) and put the directive on that instead.`;
}

export function formatCompileErrors(errors: MochiCompileError[]): string {
  const lines = errors.map((e) => {
    switch (e.kind) {
      case 'nested-hydration':
        return `Nested mochi:hydrate: <${e.child}> inside <${e.parent}> — remove mochi:hydrate from ${e.child}`;
      case 'css-bundle-failed':
        return `CSS bundle failed: ${e.cssPath} — ${e.message}`;
      case 'unresolved-island':
        return formatUnresolvedIsland(e);
    }
  });
  const header = `${errors.length} compile error${errors.length === 1 ? '' : 's'}:`;
  return `${header}\n${lines.map((l) => `• ${l}`).join('\n')}`;
}

export interface RenderResult {
  body: string;
  head: string;
  cssUrls: string[];
  bootstrapUrl: string | null;
  hasServerIslands: boolean;
  /**
   * Dev-only snapshot of `ctx.debugBarData` taken at the end of render
   * (before the per-request bag is cleared). Surfaced to the toolbar as
   * `window.__mochi_debug`. `undefined` in production.
   */
  debugBarData?: DebugBarData;
}

/**
 * Result of {@link ComponentRegistry.renderStatic} — the stateless render path
 * used for email. No islands, no shell, no request state, so there's no
 * bootstrap URL, no server-island flag, and no debug-bar snapshot.
 */
export interface StaticRenderResult {
  body: string;
  head: string;
  cssUrls: string[];
}

export interface ComponentRegistryOptions {
  development?: boolean;
  /** Bundle and surface the dev-only debug-bar entry. Default: same as `development`. */
  debugBar?: boolean;
  /** Directory for build artifacts (cwd-relative). Default: `./.mochi`. */
  outDir?: string;
  /** URL prefix for framework client assets (JS/CSS). Default: `/_mochi`. */
  assetPrefix?: string;
  /** User Svelte config (loaded from `svelte.config.js`). Its `compilerOptions` are merged into the framework's defaults. */
  svelteConfig?: MochiSvelteConfig;
  /** Which compiler emits component JS. `'rsvelte'` needs the optional adapter package. Default: `'svelte'`. */
  svelteCompiler?: MochiSvelteCompiler;
  /** User-injected markdown integration. When unset, `.md`/`.svx` imports are not handled. */
  markdown?: MarkdownConfig;
  /** Run the whole-program svelte-shaker pass before compiling. Production only — `prepareShake()` is a no-op in dev. */
  optimize?: boolean | MochiSvelteShakerOptions;
  /**
   * Warning when a dependency drags a large module into the build graph
   * that's almost entirely tree-shaken away — the "barrel import" smell (e.g.
   * `import { Sun } from '@lucide/svelte'` instead of `@lucide/svelte/icons/sun`),
   * which slows every rebuild because the big re-export file is re-parsed each time.
   * On a live server it fires once per package as it's seen; a `mochi-framework build`
   * collapses the offenders into a single grouped summary line. Default: enabled. `false` silences
   * it entirely; `{ ignore: ['pkg-name'] }` suppresses specific packages you can't fix;
   * `minBytes` overrides the parsed-size threshold (default 50 KB).
   */
  barrelWarnings?: boolean | MochiBarrelWarningOptions;
  /**
   * Buffer barrel offenders instead of logging each as it's seen, so a one-shot
   * `mochi-framework build` can emit them as one grouped summary via
   * `flushBarrelWarnings()`. A live server (dev or prod-without-manifest) must
   * leave this off — it compiles lazily and has no end-of-build flush point, so
   * buffered warnings would never surface. Default: `false`.
   */
  bufferBarrelWarnings?: boolean;
}

/**
 * Precompute the per-component island lookups a render needs. Called once when a
 * compiled-component entry is created (compileAll / fromManifest) so renderComponent
 * reads them instead of rebuilding three collections on every render.
 */
function indexHydratables(hydratables: HydratableComponent[]): {
  hydratablesByName: Map<string, HydratableComponent>;
  hydratablesByPath: Map<string, HydratableComponent[]>;
  islandPaths: Set<string>;
} {
  // Multi-valued by path: a single file can back several islands (named exports).
  const byPath = new Map<string, HydratableComponent[]>();
  for (const h of hydratables) {
    const list = byPath.get(h.resolvedPath);
    if (list) {
      list.push(h);
    } else {
      byPath.set(h.resolvedPath, [h]);
    }
  }
  return {
    hydratablesByName: new Map(hydratables.map((h) => [h.name, h])),
    hydratablesByPath: byPath,
    islandPaths: new Set(hydratables.map((h) => h.resolvedPath)),
  };
}

export class ComponentRegistry {
  private compiledComponents: Map<
    string,
    {
      // Named exports alongside `default` back named-export islands.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      module: { default: any } & Record<string, any>;
      cssComponents: Set<string>;
      hydratables: HydratableComponent[];
      // Island lookups derived once from `hydratables` at compile time and reused
      // on every render (renderComponent), instead of rebuilt per render.
      hydratablesByName: Map<string, HydratableComponent>;
      hydratablesByPath: Map<string, HydratableComponent[]>;
      islandPaths: Set<string>;
      // Absolute path to the compiled `.server.js` on disk. Recorded from the
      // build's metafile (not reconstructed from the source basename) so two
      // entrypoints sharing a basename — e.g. PageOne.svelte in two demo
      // folders — resolve to their own distinct, hashed outputs.
      ssrPath: string;
    }
  > = new Map();
  private hydratableComponents: HydratableComponent[] = [];
  /**
   * Prebuilt, minified ServerIsland inline web-component script. Set by `build()`
   * (via `setServerIslandScript`) and restored by `fromManifest`, so the runtime
   * skips the startup `Bun.build`. Undefined in dev / prod-without-manifest, where
   * `Mochi.serve()` builds it on demand (memoized).
   */
  serverIslandClientJs?: string;
  /** Disk path recorded for the manifest; see `serverIslandClientJs`. */
  private serverIslandScriptFile?: string;
  private componentEntryUrls: Map<string, string> = new Map();
  private islandBootstrapUrl: string | null = null;
  private debugBarUrl: string | null = null;
  private clientFiles: Map<string, string> = new Map();
  /** Maps component file path → CSS URL */
  private cssFileUrls: Map<string, string> = new Map();
  /**
   * Snapshot of the last-extracted raw CSS for each component path. The
   * write-CSS-files loop in `compileAll` uses content equality (not just
   * presence in `cssFileUrls`) to decide whether to re-emit; without this
   * snapshot, an HMR recompile of a child component would short-circuit
   * and leave the stale hashed URL in place.
   */
  private cssRawByPath: Map<string, string> = new Map();
  /** Maps resolved CSS-import path → served URL (e.g. /import-css/inter-<hash>.css) */
  private importedCssUrls: Map<string, string> = new Map();
  /** Maps page entry .svelte path → set of resolved CSS-import paths reachable from it */
  private entryImportedCss: Map<string, Set<string>> = new Map();
  /**
   * Maps page entry path → set of every absolute file path that contributed to
   * the SSR bundle (transitive imports from Bun's metafile). Used by the dev
   * watcher's `recompileChanged()` to invalidate only the pages whose dep
   * graph contains the changed file.
   */
  private entryDeps: Map<string, Set<string>> = new Map();
  private clientStats: {
    outputs: {
      name: string;
      size: number;
      inputs: { path: string; size: number }[];
      imports: string[];
    }[];
  } | null = null;
  /** Stats for side-effect CSS bundles, merged into clientStats at read time. */
  private importedCssStats: {
    name: string;
    size: number;
    inputs: { path: string; size: number }[];
    imports: string[];
  }[] = [];
  /** Maps server island component name → resolved file path */
  private serverIslandPaths: Map<string, string> = new Map();
  /** Maps server island component name → the export it renders, when not `default` (named exports only). */
  private serverIslandExports: Map<string, string> = new Map();
  /** Maps public URL path → disk path (relative to cwd) for static files from `public/`. */
  private publicFiles: Map<string, string> = new Map();
  /** Maps served asset URL → emitted asset for locally-imported images (`import x from './x.png'`). */
  private localImageAssets: Map<string, LocalImageAsset> = new Map();
  readonly development: boolean;
  /** Set by `fromManifest()`; distinguishes a prebuilt-manifest boot from a live, compile-on-demand one. */
  loadedFromManifest = false;
  readonly debugBarEnabled: boolean;
  readonly outDir: string;
  readonly assetPrefix: string;
  svelteConfig: MochiSvelteConfig;
  private readonly svelteCompiler: MochiSvelteCompiler | undefined;
  readonly markdown: MarkdownConfig | undefined;
  readonly optimize: boolean | MochiSvelteShakerOptions;
  private readonly barrelWarningsEnabled: boolean;
  private readonly barrelIgnore: Set<string>;
  private readonly barrelMinBytes: number;
  private readonly barrelBuffering: boolean;
  /** Packages already warned about this process, so the warning fires once, not on every rebuild. */
  private readonly warnedBarrels = new Set<string>();
  /** Buffer used when `bufferBarrelWarnings` is on: barrels collected across the build, flushed as one grouped summary by `flushBarrelWarnings()`. */
  private pendingBarrels: HeavyBarrel[] = [];
  /** absPath → slimmed `.svelte` source from the last `prepareShake()`; empty when shaking is off. */
  private shakenSources: Map<string, string> = new Map();
  private errors: MochiCompileError[] = [];
  /** Bumped each time `buildClientBundle()` runs; read+reset by `recompileAll()`. */
  private clientBundleCallCount = 0;
  /**
   * Per-registry compiled-output cache. Instance-scoped (not a module global) so
   * two registries with different markdown/preprocessor config can't serve each
   * other stale output for the same path — see {@link CompileCache}.
   */
  readonly compileCache = new CompileCache();

  constructor(opts: ComponentRegistryOptions = {}) {
    this.development = opts.development ?? true;
    this.debugBarEnabled = this.development && (opts.debugBar ?? true);
    this.outDir = opts.outDir ?? './.mochi';
    this.assetPrefix = normalizeAssetPrefix(opts.assetPrefix);
    this.svelteConfig = opts.svelteConfig ?? {};
    this.svelteCompiler = opts.svelteCompiler;
    this.markdown = opts.markdown;
    this.optimize = opts.optimize ?? false;
    const bw = opts.barrelWarnings;
    this.barrelWarningsEnabled = bw !== false;
    this.barrelIgnore = new Set(typeof bw === 'object' ? (bw.ignore ?? []) : []);
    this.barrelMinBytes = (typeof bw === 'object' ? bw.minBytes : undefined) ?? 50 * 1024;
    this.barrelBuffering = opts.bufferBarrelWarnings ?? false;
  }

  /**
   * Run the whole-program svelte-shaker pass over the app and cache the slimmed
   * source so the compile `onLoad` handlers feed it to the Svelte compiler
   * instead of the raw file. No-op in dev (shaking is whole-program, so per-file
   * HMR can't safely reuse a one-time shake) or when the option is off. On any
   * failure we fall back to unshaken disk reads rather than break the build.
   */
  async prepareShake(appRoot = path.resolve('src')): Promise<void> {
    const opt = this.optimize;
    const enabled = typeof opt === 'object' ? opt.enabled : !!opt;
    if (!enabled || this.development) {
      return;
    }
    if (!fs.existsSync(appRoot)) {
      logger.warn(`svelte-shaker: no source directory at ${appRoot}; nothing to shake`);
      return;
    }
    try {
      const { shaken, originals } = await shakeApp(appRoot);
      if (shaken.size === 0) {
        logger.warn(`svelte-shaker: no .svelte components found under ${appRoot}; nothing to shake`);
      }
      const cwd = process.cwd();
      const exclude = typeof opt === 'object' ? (opt.exclude ?? []) : [];
      let excluded = 0;
      if (exclude.length > 0) {
        const globs = exclude.map((p) => new Bun.Glob(p));
        for (const id of [...shaken.keys()]) {
          // Glob patterns are written with forward slashes, so match against
          // POSIX-ified paths or Windows never excludes anything.
          const rel = toPosixPath(path.relative(cwd, id));
          // Excluded files compile from original source. Safe regardless: the
          // whole-app scan still covered them as call sites of other components.
          if (globs.some((g) => g.match(rel) || g.match(toPosixPath(id)))) {
            shaken.delete(id);
            excluded++;
          }
        }
      }
      this.shakenSources = shaken;

      // The shake map holds *every* in-scope component — untouched ones are
      // returned verbatim — so its size is the scan count, not the number
      // changed. Diff against the originals the engine already read (no second
      // disk pass) to find what the shaker actually slimmed.
      const changed: { name: string; before: number; after: number }[] = [];
      for (const [id, out] of shaken) {
        const original = originals.get(id) ?? out;
        if (original !== out) {
          changed.push({ name: relForDisplay(id), before: Buffer.byteLength(original, 'utf8'), after: Buffer.byteLength(out, 'utf8') });
        }
      }
      logger.info(`svelte-shaker: slimmed ${changed.length} of ${shaken.size} component(s)${excluded > 0 ? `, ${excluded} excluded` : ''}`);
      this.reportShake(changed);
    } catch (e) {
      // Empty cache -> every onLoad reads the original source, so a failed shake
      // never breaks the build (`shakenSources.get(path) ?? Bun.file(path)`).
      logger.warn('svelte-shaker: optimization skipped; building from original sources (output is unaffected).');
      logger.warn('svelte-shaker: this looks like a svelte-shaker bug — please report it with the error below at https://github.com/baseballyama/svelte-shaker/issues');
      logger.error(e);
      this.shakenSources = new Map();
    }
  }

  /** Log a per-component before→after source-byte breakdown for the changed components. */
  private reportShake(rows: { name: string; before: number; after: number }[]): void {
    if (rows.length === 0) {
      return;
    }
    rows.sort((a, b) => b.before - b.after - (a.before - a.after));
    const nameWidth = Math.max(...rows.map((r) => r.name.length));
    const pct = (before: number, after: number): string => `${(((after - before) / before) * 100).toFixed(1)}%`;
    logger.info('svelte-shaker: source size before → after');
    for (const r of rows) {
      logger.info(`  ${r.name.padEnd(nameWidth)}  ${prettyBytes(r.before)} → ${prettyBytes(r.after)}  (${pct(r.before, r.after)})`);
    }
    const totalBefore = rows.reduce((s, r) => s + r.before, 0);
    const totalAfter = rows.reduce((s, r) => s + r.after, 0);
    logger.info(`  ${`total (${rows.length} changed)`.padEnd(nameWidth)}  ${prettyBytes(totalBefore)} → ${prettyBytes(totalAfter)}  (${pct(totalBefore, totalAfter)})`);
  }

  getServerIslandPath(name: string): string | undefined {
    return this.serverIslandPaths.get(name);
  }

  /** The named export a server island renders; undefined means the module's default export. */
  getServerIslandExport(name: string): string | undefined {
    return this.serverIslandExports.get(name);
  }

  /** Number of pages currently in the compile cache (used by the dev watcher's recompile events). */
  getPageCount(): number {
    return this.compiledComponents.size;
  }

  getServerIslandPaths(): Map<string, string> {
    return this.serverIslandPaths;
  }

  /** Asset URL of a component's compiled scoped CSS, by resolved path (none if it has no styles). */
  getComponentCssUrl(componentPath: string): string | undefined {
    return this.cssFileUrls.get(componentPath);
  }

  setPublicFiles(map: Map<string, string> | Record<string, string>): void {
    this.publicFiles = map instanceof Map ? new Map(map) : new Map(Object.entries(map));
  }

  getPublicFiles(): Map<string, string> {
    return this.publicFiles;
  }

  /** Emitted assets for locally-imported images, keyed by served URL. */
  getLocalImageAssets(): Map<string, LocalImageAsset> {
    return this.localImageAssets;
  }

  /** Record the prebuilt ServerIsland inline script (content + disk path for the manifest). */
  setServerIslandScript(diskPath: string, content: string): void {
    this.serverIslandScriptFile = diskPath;
    this.serverIslandClientJs = content;
  }

  /**
   * Compile a single page entrypoint. Thin delegate to `compileAll` so a
   * lazy/on-demand caller (e.g. `renderComponent`, server-island fetch) can
   * still trigger one compile in isolation.
   *
   * Boot-time and dev-watcher paths should call `compileAll` directly with
   * the full set of entrypoints — that produces a single shared SSR bundle
   * (deduplicates `devalue`/etc. via Bun's `splitting: true`).
   */
  async compile(filename: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.compileAll([filename], opts);
  }

  evict(absolutePath: string): void {
    const key = this.compiledComponents.has(absolutePath) ? absolutePath : [...this.compiledComponents.keys()].find((k) => path.resolve(k) === absolutePath);
    if (key) {
      this.compiledComponents.delete(key);
      this.entryDeps.delete(key);
      this.entryImportedCss.delete(key);
    }
  }

  isCompiled(absolutePath: string): boolean {
    return this.compiledComponents.has(absolutePath) || [...this.compiledComponents.keys()].some((k) => path.resolve(k) === absolutePath);
  }

  /**
   * Compile a cohort of page entrypoints in one `Bun.build` invocation with
   * `splitting: true`. Shared transitive deps (npm packages and the
   * `mochi-framework` virtual module's internals) land in shared chunk files
   * alongside each `<basename>.server.js`, so they're emitted exactly once
   * across the entire cohort.
   */
  async compileAll(filenames: string[], opts: { force?: boolean; deferClientBundle?: boolean } = {}): Promise<void> {
    const todo = opts.force ? [...new Set(filenames)] : [...new Set(filenames)].filter((f) => !this.compiledComponents.has(f));
    if (todo.length === 0) {
      return;
    }

    for (const f of todo) {
      mochiEvents.emit('compile:start', { path: f });
    }
    const compileStart = performance.now();

    const cssMap = new Map<string, string>();
    const importedCssPaths = new Set<string>();
    const allHydratables: HydratableComponent[] = [];
    const allServerIslands: ServerIslandComponent[] = [];
    const preprocessCacheStats = createPreprocessCacheStats();
    const compileCacheStats = createCompileCacheStats();
    const fileHydratables = new Map<string, HydratableComponent[]>();
    const fileServerIslands = new Map<string, ServerIslandComponent[]>();
    const filePreprocessErrors = new Map<string, PreprocessIslandError[]>();
    const development = this.development;
    const userCompilerOptions = this.svelteConfig.compilerOptions ?? {};
    const backend = await resolveSvelteCompiler(this.svelteCompiler);
    const serverFingerprint = compileFingerprint(userCompilerOptions, development, backendId(backend));
    const compileCache = this.compileCache;
    const markdown = this.markdown;
    const shakenSources = this.shakenSources;
    const imageAssetLoader = createImageAssetLoader({
      outDir: this.outDir,
      assetPrefix: this.assetPrefix,
      assets: this.localImageAssets,
      rejectUnknown: this.loadedFromManifest && !this.development,
    });

    const sveltePlugin: BunPlugin = {
      name: 'svelte-ssr',
      setup(build) {
        build.onLoad({ filter: applyFilter('image:fileFilter', IMAGE_FILE_FILTER, { target: 'server' }) }, imageAssetLoader);
        // Side-effect CSS imports (e.g. `import '@fontsource-variable/inter'`).
        // Bun resolves bare specifiers via package.json#main to the real .css file,
        // so filtering on the resolved path catches both direct and package imports.
        // We record the path and strip the import from the SSR JS bundle — the CSS
        // is bundled out-of-band below and served as /import-css/*.
        build.onLoad({ filter: /\.css$/ }, (args) => {
          importedCssPaths.add(args.path);
          return { contents: '', loader: 'js' };
        });
        build.onResolve({ filter: /^mochi-framework$/ }, () => ({
          path: 'mochi-framework',
          namespace: 'mochi-env',
        }));
        build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
          contents: renderMochiEnvServer(development),
          loader: 'js',
        }));
        build.onResolve({ filter: /^mochi-server-island-runtime$/ }, () => ({
          path: 'mochi-server-island-runtime',
          namespace: 'mochi-server-island',
        }));
        build.onLoad({ filter: /.*/, namespace: 'mochi-server-island' }, () => ({
          contents: [`import { encryptProps } from "${toPosixPath(path.join(SRC_DIR, 'islands/serverIslandCrypto.ts'))}";`, `export { encryptProps };`].join('\n'),
          loader: 'js',
        }));
        // The preprocessor's island wrapper (`<MochiHydratableBoundary_>`) —
        // resolved to the framework's own component in the default namespace so
        // it flows through the normal `.svelte` loader below. The specifier is
        // a subpath of a package we own, but deliberately NOT in the exports
        // map: outside this plugin it must fail to resolve, not fetch a
        // squattable third-party name.
        build.onResolve({ filter: /^mochi-framework\/hydratable-boundary$/ }, () => ({
          path: path.join(SRC_DIR, 'islands/HydratableBoundary.svelte'),
        }));
        build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
          let source = await Bun.file(args.path).text();
          if (args.path.endsWith('.ts')) {
            const transpiler = new Bun.Transpiler({ loader: 'ts' });
            source = transpiler.transformSync(source);
          }
          const { js } = backend.compileModule(
            source,
            mergeCompilerOptions(userCompilerOptions, {
              generate: 'server',
              filename: args.path,
            }),
          );
          return { contents: js.code, loader: 'js' };
        });
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
          const raw = shakenSources.get(args.path) ?? (await Bun.file(args.path).text());
          const cached = compileCache.get('server', args.path, raw, serverFingerprint, compileCacheStats);
          if (cached) {
            fileHydratables.set(args.path, cached.hydratables);
            fileServerIslands.set(args.path, cached.serverIslands);
            filePreprocessErrors.set(args.path, cached.preprocessErrors);
            allHydratables.push(...cached.hydratables);
            allServerIslands.push(...cached.serverIslands);
            if (cached.css) {
              cssMap.set(args.path, cached.css);
            }
            return { contents: cached.js, loader: 'js' };
          }
          const preprocessed = await applyUserPreprocessors(raw, args.path, 'server', development);
          // Vendored .svelte from node_modules can never carry `mochi:*` directives
          const isVendored = args.path.includes(`${path.sep}node_modules${path.sep}`);
          const preprocessResult = isVendored
            ? { transformed: preprocessed, hydratables: [] as HydratableComponent[], serverIslands: [] as ServerIslandComponent[], errors: [] as PreprocessIslandError[] }
            : cachedPreprocessHydratable(preprocessed, args.path, preprocessCacheStats);
          const { hydratables, serverIslands, errors } = preprocessResult;
          fileHydratables.set(args.path, hydratables);
          fileServerIslands.set(args.path, serverIslands);
          filePreprocessErrors.set(args.path, errors);
          allHydratables.push(...hydratables);
          allServerIslands.push(...serverIslands);

          const { js, css } = backend.compile(
            preprocessResult.transformed,
            mergeCompilerOptions(userCompilerOptions, {
              generate: 'server',
              filename: args.path,
            }),
          );
          const cssCode = css?.code ?? null;
          if (cssCode) {
            cssMap.set(args.path, cssCode);
          }
          compileCache.set('server', args.path, raw, serverFingerprint, {
            js: js.code,
            css: cssCode,
            hydratables,
            serverIslands,
            preprocessErrors: errors,
          });
          return { contents: js.code, loader: 'js' };
        });
        if (markdown) {
          build.onLoad(
            { filter: MARKDOWN_FILE_FILTER },
            createMarkdownLoader({
              markdown,
              target: 'server',
              development,
              cssMap,
              userCompilerOptions,
              backend,
              compileCache,
              compileCacheStats,
              hydration: { fileHydratables, allHydratables, allServerIslands, filePreprocessErrors, preprocessCacheStats },
            }),
          );
        }
      },
    };

    const compileOutDir = path.resolve(`${this.outDir}/svelte-compile`);
    const result = await Bun.build({
      entrypoints: todo.map((f) => path.resolve(f)),
      plugins: [sveltePlugin],
      target: 'bun',
      conditions: ['svelte'],
      // Svelte stays external because it's a peer dep the consumer already
      // provides. Everything else (devalue, cookie, etc.) gets bundled
      // — but with `splitting: true` Bun emits shared transitive
      // deps into separate chunk files alongside each entry's `.server.js`,
      // so they're written exactly once across the cohort.
      external: ['svelte', 'svelte/*'],
      splitting: true,
      outdir: compileOutDir,
      naming: {
        // Hash the entry name so entrypoints that share a basename (e.g.
        // PageOne.svelte in two different demo folders) don't collide on one
        // output path. The real on-disk name is read back from the metafile.
        entry: '[name]-[hash].server.js',
        chunk: 'chunk-[hash].js',
        asset: '[name]-[hash].[ext]',
      },
      metafile: true,
      throw: false,
    });

    // Detection recomputes nested-hydration and unresolved-island errors for
    // every file in this batch, so drop any prior ones for the recompiled files
    // first. Without this, a fixed mistake keeps 500-ing every page until a
    // restart, and an unfixed one is re-pushed (duplicated) on every save.
    //
    // This runs BEFORE the `result.success` throw on purpose. The hydration maps
    // are populated by the svelte `onLoad`, which fires for every entry before
    // Bun resolves transitive JS deps — so a later bundler failure must not
    // swallow a structural error we already detected. It also keeps these errors
    // reported under the `bun test`-only Bun-bundler EISDIR bug, where an SSR
    // build can fail after preprocessing already succeeded.
    this.errors = this.errors.filter(
      (e) => !(e.kind === 'nested-hydration' && fileHydratables.has(e.parentPath)) && !(e.kind === 'unresolved-island' && filePreprocessErrors.has(e.filePath)),
    );

    for (const errors of filePreprocessErrors.values()) {
      for (const err of errors) {
        this.errors.push({ kind: 'unresolved-island', ...err });
        logger.error(`\n${formatUnresolvedIsland({ kind: 'unresolved-island', ...err })}\n`);
      }
    }

    this.warnOnBarrelImports(result.metafile);

    // Detect nested hydration — a hydratable component must not itself contain mochi:hydrate or mochi:hydrate:visible children
    const hydratablePaths = new Set(allHydratables.map((h) => h.resolvedPath));
    for (const [filePath, children] of fileHydratables) {
      if (hydratablePaths.has(filePath) && children.length > 0) {
        const parent = allHydratables.find((h) => h.resolvedPath === filePath)!;
        for (const child of children) {
          this.errors.push({
            kind: 'nested-hydration',
            parent: parent.displayName,
            child: child.displayName,
            parentPath: filePath,
            childPath: child.resolvedPath,
          });
          logger.error(
            `\nNested hydration directives are not allowed.\n  <${child.displayName}> with mochi:hydrate, mochi:hydrate:visible, or mochi:clientOnly is inside <${parent.displayName}> which is also hydratable.\n  Remove the directive from ${child.displayName} — it hydrates automatically as part of ${parent.displayName}.\n`,
          );
        }
      }
    }

    if (!result.success) {
      const message = `Svelte SSR build failed:\n${formatBuildMessages(result.logs)}`;
      for (const f of todo) {
        mochiEvents.emit('compile:error', {
          path: f,
          message,
          logs: toCompileErrorLogs(result.logs),
        });
      }
      throw new Error(message);
    }

    // Walk Bun's output graph (not the source-import graph) to attribute
    // transitive inputs to each entry. `outputs[outKey].inputs` is a flat
    // record of every source file that contributed to that chunk — keys
    // are in the same shape as `inputs[]` so they're stable to compare
    // against `cssMap` / `importedCssPaths`. The source-import walk via
    // `inputs[].imports[].path` is unusable here: Bun stores those paths
    // importer-relative, so `path.resolve` against cwd fabricates wrong
    // absolutes that miss `inputs[]` lookups, and the BFS dies one hop in.
    const outputsMeta = result.metafile?.outputs ?? {};
    const entryToOutKey = new Map<string, string>();
    for (const [outKey, outMeta] of Object.entries(outputsMeta)) {
      if (outMeta.entryPoint) {
        entryToOutKey.set(path.resolve(outMeta.entryPoint), outKey);
      }
    }

    const transitiveInputs = (rootOutKey: string): Set<string> => {
      const visited = new Set<string>();
      const queue = [rootOutKey];
      const inputs = new Set<string>();
      while (queue.length > 0) {
        const o = queue.shift()!;
        if (visited.has(o)) {
          continue;
        }
        visited.add(o);
        const meta = outputsMeta[o];
        if (!meta) {
          continue;
        }
        for (const inputPath of Object.keys(meta.inputs)) {
          inputs.add(path.resolve(inputPath));
        }
        for (const imp of meta.imports ?? []) {
          queue.push(imp.path);
        }
      }
      return inputs;
    };

    const compileDuration = performance.now() - compileStart;
    for (const filename of todo) {
      const resolvedFilename = path.resolve(filename);
      const outKey = entryToOutKey.get(resolvedFilename);
      if (!outKey) {
        throw new Error(`Svelte SSR build produced no output for ${filename}`);
      }

      // Entry names are hashed, so the on-disk filename isn't derivable from the
      // source basename. Read the actual output filename from the metafile key
      // (Bun emits it relative to cwd, but only its basename matters here) and
      // join it to the compile dir — same approach as the client build.
      const outPath = path.join(compileOutDir, path.basename(outKey));

      // Dev rebuilds re-import the same on-disk entry, so we can't rely on Bun's
      // query-string cache-busting (unreliable on Windows — returns the stale module).
      // `freshImport` copies the entry to a unique path so the re-import is a guaranteed
      // cache miss. Production compiles each entry once, so a direct import is fine.
      const mod = this.development ? await freshImport(outPath) : await import(Bun.pathToFileURL(outPath).href);

      const entryInputs = transitiveInputs(outKey);

      // Side-effect CSS imports reachable from this entry. The plugin records
      // every `.css` load globally; intersect with the entry's transitive
      // input set to get the per-entry subset.
      const entryCss = new Set<string>();
      for (const p of importedCssPaths) {
        if (entryInputs.has(path.resolve(p))) {
          entryCss.add(p);
        }
      }
      this.entryImportedCss.set(filename, entryCss);

      // Dev-watcher dep tracking: every absolute file path that contributed
      // to this entry's bundle (via its own output and any shared chunks).
      this.entryDeps.set(filename, entryInputs);

      // Per-entry hydratables / CSS components, restricted to files reachable
      // from this entry. With one batched build, plugin closures see every
      // entry's files; we narrow back per-entry via the metafile graph.
      const entryHydratables: HydratableComponent[] = [];
      const entryServerIslands: ServerIslandComponent[] = [];
      const entryCssComponents = new Set<string>();
      for (const inp of entryInputs) {
        const h = fileHydratables.get(inp);
        if (h) {
          entryHydratables.push(...h);
        }
        const si = fileServerIslands.get(inp);
        if (si) {
          entryServerIslands.push(...si);
        }
        if (cssMap.has(inp)) {
          entryCssComponents.add(inp);
        }
      }

      this.compiledComponents.set(filename, {
        module: mod,
        cssComponents: entryCssComponents,
        hydratables: entryHydratables,
        ...indexHydratables(entryHydratables),
        ssrPath: outPath,
      });

      mochiEvents.emit('compile:complete', {
        path: filename,
        ssrSizeBytes: outputsMeta[outKey]?.bytes ?? 0,
        hydratableCount: entryHydratables.length,
        serverIslandCount: entryServerIslands.length,
        durationMs: compileDuration,
      });
    }

    mochiEvents.emit('compile:batch-complete', {
      count: todo.length,
      durationMs: performance.now() - compileStart,
    });

    const files = preprocessCacheStats.hits + preprocessCacheStats.misses;
    if (files > 0) {
      mochiEvents.emit('preprocess-cache:summary', {
        hits: preprocessCacheStats.hits,
        misses: preprocessCacheStats.misses,
        files,
      });
    }

    const compileCacheFiles = compileCacheStats.hits + compileCacheStats.misses;
    if (compileCacheFiles > 0) {
      mochiEvents.emit('compile-cache:summary', {
        hits: compileCacheStats.hits,
        misses: compileCacheStats.misses,
        files: compileCacheFiles,
      });
    }

    // Write per-component CSS files to disk (minified) and track their URLs
    const cssOutDir = `${this.outDir}/svelte-css`;
    const cssTodo = [...cssMap].filter(([componentPath, cssCode]) => this.cssRawByPath.get(componentPath) !== cssCode);
    if (cssTodo.length > 0) {
      // Raw filenames carry a path hash: components that share a basename
      // (e.g. PageOne.svelte in two demo folders) would otherwise collide on
      // one raw file now that all of them are written before the build.
      const rawPathFor = (componentPath: string) => `${cssOutDir}/${path.basename(componentPath, '.svelte')}-${Bun.hash(componentPath).toString(36)}.raw.css`;
      await Promise.all(cssTodo.map(([componentPath, cssCode]) => Bun.write(rawPathFor(componentPath), cssCode)));
      // One batched Bun.build instead of one per component. Each raw file is a
      // standalone entrypoint (svelte-emitted CSS has no imports), so in-memory
      // outputs map back to their entry by basename.
      const cssResult = await Bun.build({
        entrypoints: cssTodo.map(([componentPath]) => rawPathFor(componentPath)),
        minify: true,
        throw: false,
      });
      // Read outputs even when the batch reports failure: a single malformed
      // file must not drop minification for the whole cohort. Entries without
      // an output fall back to their raw CSS below.
      const minifiedByBase = new Map<string, string>();
      for (const out of cssResult.outputs) {
        minifiedByBase.set(path.basename(out.path), await out.text());
      }
      const cssWrites: Promise<unknown>[] = [];
      for (const [componentPath, cssCode] of cssTodo) {
        const minified = minifiedByBase.get(path.basename(rawPathFor(componentPath))) ?? cssCode;
        const compName = path.basename(componentPath, '.svelte');
        const hash = Bun.hash(minified).toString(36);
        const cssFilename = `${compName}-${hash}.css`;
        const cssUrl = `${this.assetPrefix}/css/${cssFilename}`;
        cssWrites.push(Bun.write(`${cssOutDir}/${cssFilename}`, minified));
        this.clientFiles.set(cssUrl, minified);
        this.cssFileUrls.set(componentPath, cssUrl);
        this.cssRawByPath.set(componentPath, cssCode);
      }
      await Promise.all(cssWrites);
    }

    if (importedCssPaths.size > 0) {
      await this.bundleImportedCss(importedCssPaths);
    }

    // Register server island component paths
    for (const si of allServerIslands) {
      this.serverIslandPaths.set(si.name, si.resolvedPath);
      if (si.exportName !== 'default') {
        this.serverIslandExports.set(si.name, si.exportName);
      } else {
        this.serverIslandExports.delete(si.name);
      }
    }

    this.hydratableComponents.push(...allHydratables);
    if (!opts.deferClientBundle && allHydratables.length > 0) {
      await this.buildClientBundle();
    }
  }

  /**
   * Trailing client bundle for callers that batch multiple `compileAll` passes
   * with `deferClientBundle` (the CLI build compiles pages, then server
   * islands — without deferral each pass rebuilds the same monolithic bundle).
   */
  async finalizeClientBundle(): Promise<void> {
    if (this.hydratableComponents.length > 0) {
      await this.buildClientBundle();
    }
  }

  private async buildClientBundle(): Promise<void> {
    this.clientBundleCallCount += 1;
    const bundleStart = performance.now();
    const development = this.development;
    const debugBarEnabled = this.debugBarEnabled;
    const userCompilerOptions = this.svelteConfig.compilerOptions ?? {};
    const markdown = this.markdown;
    const shakenSources = this.shakenSources;
    const compileCacheStats = createCompileCacheStats();
    const backend = await resolveSvelteCompiler(this.svelteCompiler);
    const clientFingerprint = compileFingerprint(userCompilerOptions, development, backendId(backend));
    const compileCache = this.compileCache;
    // Deduplicate by island key (`<localName>_<hash>`), not resolved path — two
    // named exports of one file, or two pages aliasing the same file's default
    // under different local names, are distinct islands that each need an entry.
    const unique = new Map<string, HydratableComponent>();
    for (const c of this.hydratableComponents) {
      unique.set(c.name, c);
    }

    // Build into local maps first and swap them into the instance fields only
    // after the build succeeds — a failed `Bun.build` must not leave the registry
    // stripped (island JS would 404 until the next successful build). CSS entries
    // in `clientFiles` are per-component and stable, so they survive the swap.
    const newClientFiles = new Map<string, string>();
    const newComponentEntryUrls = new Map<string, string>();
    let newIslandBootstrapUrl: string | null = null;
    let newDebugBarUrl: string | null = null;

    const srcDir = SRC_DIR;
    // POSIX-ify every path that becomes a Bun.build entrypoint, a `filesMap`
    // key, or an embedded import specifier: forward slashes survive intact in
    // generated source (backslashes get eaten as JS escapes on Windows) and
    // keep a file's module identity consistent across all three uses.
    const hydratableIslandPath = toPosixPath(path.join(srcDir, 'web-components', 'HydratableIsland.ts'));
    const debugBarDir = path.join(srcDir, 'debug-bar') + path.sep;
    const debugBarEntryPath = toPosixPath(path.join(debugBarDir, 'debugbar-entry.ts'));

    // Generate per-component virtual entry points
    const entrypoints: string[] = [hydratableIslandPath];
    if (debugBarEnabled) {
      entrypoints.push(debugBarEntryPath);
    }
    const filesMap: Record<string, string> = {};

    for (const [, comp] of unique) {
      const entryName = `_hydrate-${comp.name}.js`;
      const entryPath = toPosixPath(path.join(srcDir, entryName));
      // String import specifiers (`import { "x" as y }`) are valid ESM and cover
      // export names that aren't identifiers.
      const importStmt =
        comp.exportName === 'default'
          ? `import ${comp.name} from "${toPosixPath(comp.resolvedPath)}";`
          : `import { ${JSON.stringify(comp.exportName)} as ${comp.name} } from "${toPosixPath(comp.resolvedPath)}";`;
      const entrySource = `import { registerComponent } from "${hydratableIslandPath}";\n${importStmt}\nregisterComponent("${comp.name}", ${comp.name});\n`;
      entrypoints.push(entryPath);
      filesMap[entryPath] = entrySource;
    }

    const cookiesClientPath = toPosixPath(path.join(srcDir, 'runtime/cookies.client.ts'));
    const enhanceClientPath = toPosixPath(path.join(srcDir, 'runtime/enhance.client.ts'));
    const imageAssetLoader = createImageAssetLoader({
      outDir: this.outDir,
      assetPrefix: this.assetPrefix,
      assets: this.localImageAssets,
      rejectUnknown: this.loadedFromManifest && !this.development,
    });

    const clientPlugin: BunPlugin = {
      name: 'svelte-client',
      setup(build) {
        build.onLoad({ filter: applyFilter('image:fileFilter', IMAGE_FILE_FILTER, { target: 'client' }) }, imageAssetLoader);
        // Mirror the SSR side-effect-CSS strip. The bundle is already linked
        // from the SSR-rendered <head> via entryImportedCss → importedCssUrls,
        // so the browser has it. Without this, Bun's default CSS handling
        // would either inline as JS-injected styles or fail the build for any
        // hydratable component that imports a stylesheet.
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
        // `.server.ts` / `.server.js` files are stripped from the client graph.
        // Resolve them into a virtual `mochi-server-only` namespace whose
        // onLoad emits a throwing-Proxy stub per discovered export. The real
        // file (with its bun:* / node:* deps) is only compiled for SSR.
        // Matches both extensioned (`./x.server.ts`) and extensionless
        // (`./x.server`) imports; the extensionless form falls back to disk
        // probing for the real .ts/.js sibling so the stub still names a
        // canonical path.
        build.onResolve({ filter: /\.server(?:\.[jt]s)?$/ }, (args) => {
          const base = args.resolveDir ? path.resolve(args.resolveDir, args.path) : path.resolve(args.path);
          let resolved = base;
          if (!/\.[jt]s$/.test(base)) {
            const tsPath = `${base}.ts`;
            const jsPath = `${base}.js`;
            if (fs.existsSync(tsPath)) {
              resolved = tsPath;
            } else if (fs.existsSync(jsPath)) {
              resolved = jsPath;
            } else {
              resolved = tsPath;
            }
          }
          return { path: resolved, namespace: 'mochi-server-only' };
        });
        build.onLoad({ filter: /.*/, namespace: 'mochi-server-only' }, async (args) => {
          const source = await Bun.file(args.path).text();
          const scan = scanServerOnlyExports(source);
          for (const w of scan.warnings) {
            logger.warn(`[mochi] ${relForDisplay(args.path)}: ${w}`);
          }
          return { contents: buildServerOnlyStubModule(args.path, scan), loader: 'js' };
        });
        build.onResolve({ filter: /^mochi-framework$/ }, () => ({
          path: 'mochi-framework',
          namespace: 'mochi-env',
        }));
        build.onLoad({ filter: /.*/, namespace: 'mochi-env' }, () => ({
          contents: renderMochiEnvClient(development, cookiesClientPath, enhanceClientPath),
          loader: 'js',
        }));
        // Client builds never run the island preprocessor, so the injected
        // boundary import shouldn't appear in a client graph — this alias is
        // cheap insurance against a stray specifier failing the whole build.
        build.onResolve({ filter: /^mochi-framework\/hydratable-boundary$/ }, () => ({
          path: path.join(SRC_DIR, 'islands/HydratableBoundary.svelte'),
        }));
        // Strip esm-env imports so DEV/BROWSER/NODE become free variables,
        // then Bun's `define` option replaces them with literal booleans.
        // This enables dead code elimination of if(DEV) blocks. Needed because
        // Bun can't propagate constants through esm-env's conditional exports.
        build.onLoad({ filter: /node_modules\/svelte\/src\/.*\.js$/ }, async (args) => {
          let source = await Bun.file(args.path).text();
          source = source.replace(/import\s*\{[^}]*\}\s*from\s*['"]esm-env['"]\s*;?/g, '');
          return { contents: source, loader: 'js' };
        });
        build.onLoad({ filter: /\.svelte\.[jt]s$/ }, async (args) => {
          let source = await Bun.file(args.path).text();
          if (args.path.endsWith('.ts')) {
            const transpiler = new Bun.Transpiler({ loader: 'ts' });
            source = transpiler.transformSync(source);
          }
          const { js } = backend.compileModule(
            source,
            mergeCompilerOptions(userCompilerOptions, {
              generate: 'client',
              filename: args.path,
              dev: development,
            }),
          );
          return { contents: js.code, loader: 'js' };
        });
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
          const source = shakenSources.get(args.path) ?? (await Bun.file(args.path).text());
          const cached = compileCache.get('client', args.path, source, clientFingerprint, compileCacheStats);
          if (cached) {
            return { contents: cached.js, loader: 'js' };
          }
          const preprocessed = await applyUserPreprocessors(source, args.path, 'client', development);
          const { js } = backend.compile(
            preprocessed,
            mergeCompilerOptions(userCompilerOptions, {
              generate: 'client',
              filename: args.path,
              // TODO: Verify that this still works after node_modules migration
              css: args.path.startsWith(debugBarDir) ? 'injected' : undefined,
              dev: development,
            }),
          );
          compileCache.set('client', args.path, source, clientFingerprint, {
            js: js.code,
            css: null,
            hydratables: [],
            serverIslands: [],
            preprocessErrors: [],
          });
          return { contents: js.code, loader: 'js' };
        });
        if (markdown) {
          build.onLoad(
            { filter: MARKDOWN_FILE_FILTER },
            createMarkdownLoader({ markdown, target: 'client', development, userCompilerOptions, backend, compileCache, compileCacheStats }),
          );
        }
      },
    };

    const result = await Bun.build({
      entrypoints,
      files: filesMap,
      plugins: [clientPlugin],
      target: 'browser',
      conditions: ['svelte', ...(development ? ['development'] : ['production'])],
      define: {
        DEV: String(development),
        BROWSER: 'true',
        NODE: 'false',
      },
      minify: true,
      splitting: true,
      naming: '[name]-[hash].[ext]',
      publicPath: `${this.assetPrefix}/client/`,
      outdir: path.resolve(`${this.outDir}/svelte-client`),
      metafile: true,
      throw: false,
    });

    if (!result.success) {
      throw new Error(`Svelte client build failed:\n${formatBuildMessages(result.logs)}`);
    }

    for (const output of result.outputs) {
      const filename = path.basename(output.path);
      newClientFiles.set(`${this.assetPrefix}/client/${filename}`, await output.text());
    }

    // Map entry-point outputs back to components using metafile.entryPoint
    // This avoids fragile filename matching.
    if (result.metafile) {
      // Build reverse lookup: entryPath -> component name (null = bootstrap)
      // Keys and the lookup below are canonicalized through the same
      // toPosixPath(path.resolve(...)) transform. The entrypoints are a mix of
      // POSIX (toPosixPath) and native (path.join) paths, while Bun's metafile
      // entryPoint is native — on Windows the formats diverge and the bootstrap
      // lookup silently misses, dropping the hydration <script>. Canonicalizing
      // both sides keeps them comparable on every platform.
      const entryToComponent = new Map<string, string | null>();
      entryToComponent.set(toPosixPath(path.resolve(hydratableIslandPath)), null);
      if (debugBarEnabled) {
        entryToComponent.set(toPosixPath(path.resolve(debugBarEntryPath)), '__debugbar__');
      }
      for (const [, comp] of unique) {
        const entryPath = toPosixPath(path.resolve(path.join(srcDir, `_hydrate-${comp.name}.js`)));
        entryToComponent.set(entryPath, comp.name);
      }

      for (const [outPath, outMeta] of Object.entries(result.metafile.outputs)) {
        if (!outMeta.entryPoint) {
          continue;
        }
        const resolvedEntry = toPosixPath(path.resolve(outMeta.entryPoint));
        const compName = entryToComponent.get(resolvedEntry);
        const url = `${this.assetPrefix}/client/${path.basename(outPath)}`;
        if (compName === null) {
          newIslandBootstrapUrl = url;
        } else if (compName === '__debugbar__') {
          newDebugBarUrl = url;
        } else if (compName !== undefined) {
          newComponentEntryUrls.set(compName, url);
        }
      }
      const outputStats = Object.entries(result.metafile.outputs).map(([outPath, outMeta]) => {
        const inputs = Object.entries(outMeta.inputs).map(([inputPath, inputMeta]) => ({
          path: toPosixPath(inputPath).replace(toPosixPath(path.resolve('.')) + '/', ''),
          size: inputMeta.bytesInOutput,
        }));
        inputs.sort((a, b) => b.size - a.size);
        const imports = (outMeta.imports ?? []).filter((i) => i.kind === 'import-statement').map((i) => path.basename(i.path));
        return {
          name: path.basename(outPath),
          size: outMeta.bytes,
          inputs,
          imports,
        };
      });
      outputStats.sort((a, b) => b.size - a.size);
      this.clientStats = { outputs: outputStats };
      this.warnOnBarrelImports(result.metafile);
    }

    // Swap the freshly-built maps into the instance fields now the build has
    // succeeded. Replace only the client-prefix JS entries; the per-component CSS
    // entries in `clientFiles` are stable and preserved.
    const clientPrefix = `${this.assetPrefix}/client/`;
    for (const key of [...this.clientFiles.keys()]) {
      if (key.startsWith(clientPrefix)) {
        this.clientFiles.delete(key);
      }
    }
    for (const [k, v] of newClientFiles) {
      this.clientFiles.set(k, v);
    }
    this.componentEntryUrls.clear();
    for (const [k, v] of newComponentEntryUrls) {
      this.componentEntryUrls.set(k, v);
    }
    this.islandBootstrapUrl = newIslandBootstrapUrl;
    this.debugBarUrl = newDebugBarUrl;

    const outputBytes = this.clientStats?.outputs.reduce((sum, o) => sum + o.size, 0) ?? 0;
    mochiEvents.emit('client-bundle:complete', {
      entryCount: entrypoints.length,
      outputBytes,
      durationMs: performance.now() - bundleStart,
    });

    const compileCacheFiles = compileCacheStats.hits + compileCacheStats.misses;
    if (compileCacheFiles > 0) {
      mochiEvents.emit('compile-cache:summary', {
        hits: compileCacheStats.hits,
        misses: compileCacheStats.misses,
        files: compileCacheFiles,
      });
    }
  }

  /**
   * Stateless SSR for email templates: no islands, no shell, no request state.
   * Unlike `renderComponent`, this never touches `ctx.islandProps` and always
   * runs outside any ambient request context (`getRequestContext()` throws
   * inside the template regardless of call site), so it can't interleave with a
   * page render. Islands and server islands are a hard error — email clients run
   * no JS and can't make the follow-up request a deferred island needs.
   */
  async renderStatic(filename: string, props?: Record<string, unknown>): Promise<StaticRenderResult> {
    await this.compile(filename);
    const entry = this.compiledComponents.get(filename);
    if (!entry) {
      throw new Error(`renderStatic: failed to compile ${filename}`);
    }
    const { module: mod, cssComponents, hydratables } = entry;

    // Island guard (pre-render): import-graph based, so it fires even for an
    // island behind a false `{#if}` — deterministic and props-independent.
    if (hydratables.length > 0) {
      const names = hydratables.map((h) => h.displayName).join(', ');
      throw new Error(
        `Email templates can't contain islands (${names}). mochi:hydrate* / mochi:clientOnly need client JS, which an email can't run — render the content inline instead.`,
      );
    }

    const development = this.development;
    const componentBaseName = path.basename(filename, path.extname(filename));
    // Keep <svelte:boundary> functional during SSR (Svelte 5.51+). Email needs
    // none of the client-hydration bookkeeping `renderComponent`'s
    // `transformError` carries — just log and degrade.
    const transformError = (err: unknown): Error => {
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(`Email SSR error in ${componentBaseName}: ${e.message}`);
      return development ? e : new Error('Email render error');
    };

    // Render fully detached from any ambient request context (see renderDetached).
    // Read body/head inside the callback so materialization happens in the cleared
    // scope — returning plain strings, never the live render object. Isolation is
    // why `getRequestContext()` throws in an email template regardless of call site.
    const { body, head } = await renderDetached(async () => {
      const rendered = await render(mod.default, { ...(props ? { props } : {}), transformError });
      return { body: rendered.body, head: rendered.head };
    });

    let output = body;

    // Server-island guard (post-render): no per-entry metadata to check up
    // front, so detect the emitted placeholder in the rendered output.
    if (output.includes('<mochi-server-island')) {
      throw new Error(`Email templates can't contain server islands (mochi:defer*) — they load over a follow-up request an email can't make. Render the content inline instead.`);
    }

    output = output.replaceAll('__MOCHI_ASSET_PREFIX__', this.assetPrefix);

    const cssUrls: string[] = [];
    for (const componentPath of cssComponents) {
      const cssUrl = this.cssFileUrls.get(componentPath);
      if (cssUrl) {
        cssUrls.push(cssUrl);
      }
    }
    // Side-effect CSS imports reachable from this entry (e.g. @fontsource fonts).
    const imported = this.entryImportedCss.get(filename);
    if (imported) {
      for (const cssPath of imported) {
        const url = this.importedCssUrls.get(cssPath);
        if (url) {
          cssUrls.push(url);
        }
      }
    }

    return {
      body: stripHydrationMarkers(output),
      head: stripHydrationMarkers(head ?? ''),
      cssUrls,
    };
  }

  async renderComponent(
    filename: string,
    props?: Record<string, unknown>,
    opts?: { stripMarkers?: boolean; idPrefix?: string; exportName?: string; context?: Map<unknown, unknown> },
  ): Promise<RenderResult> {
    await this.compile(filename);
    const { module: mod, cssComponents, hydratables, hydratablesByName, hydratablesByPath, islandPaths } = this.compiledComponents.get(filename)!;

    const development = this.development;
    const componentBaseName = path.basename(filename, path.extname(filename));
    // `transformError` makes <svelte:boundary> functional during SSR (Svelte 5.51+).
    // Without it, boundaries are no-ops on the server and a single throw in any
    // island takes down the whole page render. We return an Error instance so
    // user-written `failed` snippets can use `error instanceof Error`, with
    // `message` made enumerable so it survives `JSON.stringify` in Svelte's
    // hydration-marker comment (stack stays non-enumerable, so it doesn't leak).
    const transformError = (err: unknown): Error => {
      const e = err instanceof Error ? err : new Error(String(err));
      logger.error(`Island SSR error in ${componentBaseName}: ${e.message}`);
      mochiEvents.emit('island:error', {
        componentName: componentBaseName,
        islandId: undefined,
        kind: 'hydratable',
        message: e.message,
        stack: development ? e.stack : undefined,
      });
      const out = development ? e : new Error('Island error');
      // Svelte writes a sentinel comment at every boundary so client hydration
      // knows which branch was rendered:
      //   <!--[-->          children rendered normally
      //   <!--[!-->         pending snippet (HYDRATION_START_ELSE)
      //   <!--[?<json>-->   failed snippet (HYDRATION_START_FAILED) — the
      //                     thrown error is JSON-stringified into <json>
      // The client parses <json> back out and re-runs the `failed` snippet
      // with it during hydration (svelte/src/internal/client/dom/blocks/
      // boundary.js:168-179). Error's `message` is non-enumerable by default,
      // so without this defineProperty `JSON.stringify(err)` is `{}` — the
      // injected `<mochi-island-failure data-message={error.message}>` would
      // hydrate with `data-message=""` and the visible message would vanish.
      Object.defineProperty(out, 'message', {
        value: out.message,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return out;
    };

    const renderOptions: {
      props?: Record<string, unknown>;
      transformError: typeof transformError;
      idPrefix?: string;
      context?: Map<unknown, unknown>;
    } = {
      transformError,
    };
    if (props) {
      renderOptions.props = props;
    }
    if (opts?.idPrefix) {
      renderOptions.idPrefix = opts.idPrefix;
    }
    if (opts?.context) {
      renderOptions.context = opts.context;
    }

    // Each render owns the whole `islandProps` map: `emitIslandProps` fills it
    // during this `render()`, the HTMLRewriter pass below drains it. Clearing up
    // front makes sequential same-ctx renders self-contained — the error page
    // after a failed page render, an action's POST re-render. Nested renders no
    // longer exist (email uses `renderStatic`; the island endpoint runs in its
    // own request context), so nothing else holds pending entries here.
    const ctx = requestContext.getStore();
    ctx?.islandProps.clear();

    const component = opts?.exportName && opts.exportName !== 'default' ? mod[opts.exportName] : mod.default;
    if (!component) {
      throw new Error(
        `renderComponent: ${filename} has no export "${opts?.exportName ?? 'default'}" — the compiled module and the island registry disagree (stale manifest or removed export).`,
      );
    }
    const { body, head } = await render(component, renderOptions);

    let output = body;

    output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => this.componentEntryUrls.get(name) ?? '');

    // Track which islands are lazy (have CSS_URL placeholders) during replacement
    const lazyIslandPaths = new Set<string>();
    output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
      const h = hydratablesByName.get(name);
      if (h) {
        lazyIslandPaths.add(h.resolvedPath);
        return this.cssFileUrls.get(h.resolvedPath) ?? '';
      }
      return '';
    });

    let hasServerCssPlaceholders = false;
    output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
      hasServerCssPlaceholders = true;
      const resolvedPath = this.serverIslandPaths.get(name);
      return resolvedPath ? (this.cssFileUrls.get(resolvedPath) ?? '') : '';
    });

    output = output.replaceAll('__MOCHI_ASSET_PREFIX__', this.assetPrefix);

    const shouldStrip = opts?.stripMarkers !== false && hydratables.length === 0;
    const hasIslandsOrServerIslands = hydratables.length > 0 || hasServerCssPlaceholders;

    // Index the per-render island props registry by ref id so the rewriter
    // pass below can emit each payload as a <script type="application/json">
    // block immediately before the first island that references it. HTMLRewriter
    // visits elements in document order, so the first callback for a given
    // `props-ref` is that payload's first island; islands sharing a byte-identical
    // payload reuse one block, and blocks reused by >=2 islands get `data-shared`.
    const propsById = new Map<string, { json: string; emitCount: number }>();
    if (ctx) {
      for (const [json, entry] of ctx.islandProps) {
        propsById.set(entry.id, { json, emitCount: entry.emitCount });
      }
    }
    const emittedProps = new Set<string>();

    // Single HTMLRewriter pass: inject island props blocks, collect rendered
    // island names, detect server islands, and conditionally strip page-level
    // hydration markers.
    const renderedIslandNames = new Set<string>();
    let hasServerIslands = false;
    if (hasIslandsOrServerIslands || shouldStrip) {
      // NOTE(bun<1.4.0): don't use `el.onEndTag()` to track island nesting
      // depth — registering it inside a request's AsyncLocalStorage context
      // leaks the context frame (and the whole request) for the life of the
      // process on Bun 1.3.x. We instead flag island-internal comments via
      // element-scoped `comments` handlers, which lol-html invokes immediately
      // before the document handler for the same comment. Revert to an onEndTag
      // depth counter once the minimum supported Bun is >= 1.4.0.
      let insideIsland = false;
      const rewriter = new HTMLRewriter();
      if (hasIslandsOrServerIslands) {
        rewriter
          .on('mochi-hydratable-island', {
            element(el) {
              const raw = el.getAttribute('component-name');
              if (raw) {
                renderedIslandNames.add(raw);
              }
              injectIslandPropsBlock(el, propsById, emittedProps);
            },
            comments() {
              insideIsland = true;
            },
          })
          .on('mochi-server-island', {
            element() {
              hasServerIslands = true;
            },
            comments() {
              insideIsland = true;
            },
          });
      }
      if (shouldStrip) {
        rewriter.onDocument({
          comments(comment) {
            if (insideIsland) {
              insideIsland = false;
              return;
            }
            if (isSvelteMarker(comment.text)) {
              comment.remove();
            }
          },
        });
      }
      output = rewriter.transform(output);
    }

    let debugBarData: RenderResult['debugBarData'];
    if (ctx?.debugBarData) {
      debugBarData = { ...ctx.debugBarData };

      if (this.debugBarEnabled && this.clientStats) {
        const urlToComponent = new Map<string, string>();
        for (const [name, url] of this.componentEntryUrls) {
          urlToComponent.set(url, name);
        }
        // Island identity keys are `<localName>_<hash>`; show the bare local name
        // in the debug bar's bundle list instead of the hashed key.
        const displayByKey = new Map(this.hydratableComponents.map((h) => [h.name, h.displayName]));
        const pageHasIslands = hydratables.length > 0;
        const bundles: NonNullable<typeof debugBarData.bundles> = [];
        const outputByName = new Map(this.clientStats.outputs.map((o) => [o.name, o]));
        for (const output of this.clientStats.outputs) {
          const url = `${this.assetPrefix}/client/${output.name}`;
          if (url === this.debugBarUrl) {
            continue;
          }
          if (url === this.islandBootstrapUrl) {
            if (!pageHasIslands) {
              continue;
            }
            const wcInputs = this.collectWebComponentInputs(output, outputByName);
            const wcSize = wcInputs.reduce((sum, i) => sum + i.size, 0);
            bundles.push({
              url,
              label: 'Island runtime',
              sizeBytes: wcSize,
              kind: 'bootstrap',
              inputs: ComponentRegistry.cleanInputs(wcInputs),
            });
          } else {
            const compName = urlToComponent.get(url);
            const cleaned = ComponentRegistry.cleanInputs(output.inputs);
            const nonWc = cleaned.filter((i) => !i.path.includes('web-components/'));
            const wcDeduct = cleaned.reduce((s, i) => s + (i.path.includes('web-components/') ? i.size : 0), 0);
            if (compName) {
              if (!renderedIslandNames.has(compName)) {
                continue;
              }
              bundles.push({ url, label: displayByKey.get(compName) ?? compName, sizeBytes: output.size - wcDeduct, kind: 'island', inputs: nonWc });
            } else {
              if (!pageHasIslands) {
                continue;
              }
              bundles.push({ url, label: output.name, sizeBytes: output.size - wcDeduct, kind: 'chunk', inputs: nonWc });
            }
          }
        }
        debugBarData.bundles = bundles;
      }
    }

    const cssUrls: string[] = [];
    for (const componentPath of cssComponents) {
      const cssUrl = this.cssFileUrls.get(componentPath);
      if (!cssUrl) {
        continue;
      }
      if (lazyIslandPaths.has(componentPath)) {
        continue;
      }
      if (islandPaths.has(componentPath)) {
        const hs = hydratablesByPath.get(componentPath);
        if (hs && hs.every((h) => !renderedIslandNames.has(h.name))) {
          continue;
        }
      }
      cssUrls.push(cssUrl);
    }

    // Append URLs for side-effect CSS imports reachable from this entry
    // (e.g. @fontsource fonts imported in a page's <script>).
    const imported = this.entryImportedCss.get(filename);
    if (imported) {
      for (const cssPath of imported) {
        const url = this.importedCssUrls.get(cssPath);
        if (url) {
          cssUrls.push(url);
        }
      }
    }

    // Always collapse the doubled-marker pattern (Svelte SSR bug for
    // `$state` arrays + `{@attach}`). Strictly matched open+close so it only
    // fires on the actual bug; no-op otherwise.
    const normalized = normalizeIslandHydrationMarkers(output);
    const headStr = head ?? '';
    return {
      body: normalized,
      head: shouldStrip ? stripHydrationMarkers(headStr) : headStr,
      cssUrls,
      bootstrapUrl: hydratables.length > 0 ? this.islandBootstrapUrl : null,
      hasServerIslands,
      debugBarData,
    };
  }

  private static cleanInputPath(p: string): string {
    return p.replace(/^(?:\.\.\/)*node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?/, '');
  }

  /**
   * Once-per-package heavy-barrel detection over a finished build's metafile. On a live server each
   * offender is warned immediately; under `bufferBarrelWarnings` (the one-shot build) they're buffered
   * and emitted as one grouped summary by `flushBarrelWarnings()`.
   */
  private warnOnBarrelImports(metafile: BarrelMetafile | undefined): void {
    if (!this.barrelWarningsEnabled || !metafile) {
      return;
    }
    // Barrel detection is an advisory diagnostic — it must never break a build or
    // dev rebuild. A malformed metafile, a throwing user `barrel:warn` filter, etc.
    // are swallowed (debug-logged) rather than propagated.
    try {
      for (const barrel of detectHeavyBarrels(metafile, this.barrelMinBytes, this.barrelIgnore)) {
        if (this.warnedBarrels.has(barrel.pkg)) {
          continue;
        }
        this.warnedBarrels.add(barrel.pkg);
        const { pkg, file, bytes, usedRatio } = barrel;
        // The `barrel:warn` filter can rewrite the line or return null to drop it,
        // for silencing logic richer than the static `ignore` list. In a build the
        // rewritten text feeds the grouped summary's count but not its wording.
        const line = applyFilter('barrel:warn', formatBarrelLine(barrel), { pkg, file, bytes, usedRatio });
        if (line === null) {
          continue;
        }
        if (this.barrelBuffering) {
          this.pendingBarrels.push(barrel);
        } else {
          logger.warn(line);
        }
      }
    } catch (err) {
      logger.debug('barrel detection skipped:', err);
    }
  }

  /** Flush buffered barrel offenders as a single grouped warning. No-op when buffering is off or nothing was collected. */
  flushBarrelWarnings(): void {
    if (this.pendingBarrels.length === 0) {
      return;
    }
    try {
      logger.warn(formatBarrelSummary(this.pendingBarrels));
    } catch (err) {
      logger.debug('barrel summary skipped:', err);
    } finally {
      this.pendingBarrels = [];
    }
  }

  private static cleanInputs(inputs: { path: string; size: number }[]): { path: string; size: number }[] {
    return inputs.map((i) => ({ path: ComponentRegistry.cleanInputPath(i.path), size: i.size }));
  }

  private collectWebComponentInputs(
    entry: { inputs: { path: string; size: number }[]; imports: string[] },
    outputByName: Map<string, { inputs: { path: string; size: number }[]; imports: string[] }>,
  ): { path: string; size: number }[] {
    const merged = new Map<string, number>();
    const addInputs = (inputs: { path: string; size: number }[]) => {
      for (const i of inputs) {
        if (i.path.includes('web-components/')) {
          merged.set(i.path, (merged.get(i.path) ?? 0) + i.size);
        }
      }
    };
    addInputs(entry.inputs);
    const visited = new Set<string>();
    const queue = [...entry.imports];
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (visited.has(name)) {
        continue;
      }
      visited.add(name);
      const dep = outputByName.get(name);
      if (dep) {
        addInputs(dep.inputs);
        queue.push(...dep.imports);
      }
    }
    return [...merged.entries()].map(([p, s]) => ({ path: p, size: s })).sort((a, b) => b.size - a.size);
  }

  /** Get the client entry URL for a hydratable component by name. */
  getComponentEntryUrl(name: string): string | undefined {
    return this.componentEntryUrls.get(name);
  }

  getIslandBootstrapUrl(): string | null {
    return this.islandBootstrapUrl;
  }

  getClientFile(urlPath: string): string | undefined {
    return this.clientFiles.get(urlPath);
  }

  getClientFiles(): Map<string, string> {
    return this.clientFiles;
  }

  getClientStats() {
    if (!this.clientStats) {
      return this.importedCssStats.length > 0 ? { outputs: [...this.importedCssStats] } : null;
    }
    return { outputs: [...this.clientStats.outputs, ...this.importedCssStats] };
  }

  getDebugBarUrl(): string | null {
    return this.debugBarUrl;
  }

  getErrors(): MochiCompileError[] {
    return this.errors;
  }

  /** Clear all compiled/cached state so components are recompiled on next render. */
  clearCompileCache(): void {
    this.compiledComponents.clear();
    this.hydratableComponents = [];
    this.componentEntryUrls.clear();
    this.islandBootstrapUrl = null;
    this.debugBarUrl = null;
    this.clientFiles.clear();
    this.cssFileUrls.clear();
    this.cssRawByPath.clear();
    this.importedCssUrls.clear();
    this.entryImportedCss.clear();
    this.entryDeps.clear();
    this.importedCssStats = [];
    this.clientStats = null;
    this.errors = [];
    this.serverIslandPaths.clear();
    this.serverIslandExports.clear();
    // Only this per-registry map is cleared; the globalThis registry
    // (localAssetRegistry) deliberately stays append-only so already-rendered
    // dev HTML can still resolve a replaced image's old hashed URL. The
    // manifest is built from this map, so stale globals never reach prod.
    this.localImageAssets.clear();
  }

  /**
   * Bundle a set of side-effect CSS import paths in parallel. On failure,
   * pushes a `css-bundle-failed` entry into `this.errors` so the dev overlay
   * surfaces it. Hashed naming prevents collisions between entrypoints that
   * share a filename (e.g. both fontsource packages ship `index.css`).
   */
  private async bundleImportedCss(cssPaths: Iterable<string>): Promise<void> {
    const importCssOutDir = path.resolve(`${this.outDir}/import-css`);
    const todo = [...cssPaths].filter((p) => !this.importedCssUrls.has(p));
    if (todo.length === 0) {
      return;
    }

    await Promise.all(
      todo.map(async (cssPath) => {
        const cssResult = await Bun.build({
          entrypoints: [cssPath],
          outdir: importCssOutDir,
          naming: { entry: '[name]-[hash].[ext]' },
          throw: false,
        });
        if (!cssResult.success) {
          const message = `\n${formatBuildMessages(cssResult.logs)}`;
          logger.error(`Failed to bundle CSS import ${cssPath}:${message}`);
          this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
          return;
        }
        const out = cssResult.outputs.find((o) => o.path.endsWith('.css'));
        if (!out) {
          const message = 'bundle produced no .css output';
          logger.error(`CSS bundle for ${cssPath}: ${message}`);
          this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
          return;
        }
        const urlPath = `${this.assetPrefix}/import-css/${path.basename(out.path)}`;
        // Read from disk: when Bun.build writes via `outdir`, the output's
        // .text() may return empty — the file on disk is the source of truth.
        const rawCss = await Bun.file(out.path).text();
        const cssText = restoreVariationsFormat(rawCss);
        if (cssText !== rawCss) {
          await Bun.write(out.path, cssText);
        }
        this.clientFiles.set(urlPath, cssText);
        this.importedCssUrls.set(cssPath, urlPath);
        this.importedCssStats.push({
          name: path.basename(out.path),
          size: cssText.length,
          inputs: [{ path: relForDisplay(cssPath), size: cssText.length }],
          imports: [],
        });
      }),
    );
  }

  /**
   * Re-bundle every previously seen side-effect CSS import. Used by the dev
   * watcher's CSS-only fast-path so a `.css` edit doesn't need a full SSR
   * recompile — page modules and entry tracking are left alone.
   */
  async rebundleImportedCss(): Promise<void> {
    const cssPaths = new Set<string>();
    for (const set of this.entryImportedCss.values()) {
      for (const p of set) {
        cssPaths.add(p);
      }
    }
    // Drop bundle-failure errors so a fixed file clears the overlay; nested-
    // hydration errors come from the SSR pass and aren't relevant here.
    this.errors = this.errors.filter((e) => e.kind !== 'css-bundle-failed');
    // Drop existing import-css entries from clientFiles so stale URLs don't
    // linger when content (and therefore hash) changes.
    const importCssPrefix = `${this.assetPrefix}/import-css/`;
    for (const key of [...this.clientFiles.keys()]) {
      if (key.startsWith(importCssPrefix)) {
        this.clientFiles.delete(key);
      }
    }
    this.importedCssUrls.clear();
    this.importedCssStats = [];
    await this.bundleImportedCss(cssPaths);
  }

  // Run a forced batch recompile, swallowing failures with a uniform log
  // pattern so the dev watcher's reload chain keeps moving on a broken save.
  private async safeBatchCompile(entries: string[], label: string): Promise<void> {
    try {
      await this.compileAll(entries, { force: true });
    } catch (e) {
      logger.warn(`${label}: ${e instanceof Error ? e.message : e}`);
      if (e instanceof AggregateError) {
        for (const msg of e.errors) {
          logger.error(msg);
        }
      } else if (e instanceof Error && e.stack) {
        logger.error(e.stack);
      }
    }
  }

  // Rebuild the flat hydratable union from the current per-page entries.
  // Called after a rebuild loop completes so the union reflects only pages
  // that survived; cheap enough that we redo it whole rather than splicing.
  private rebuildHydratables(): void {
    this.hydratableComponents = [];
    for (const e of this.compiledComponents.values()) {
      this.hydratableComponents.push(...e.hydratables);
    }
  }

  /**
   * Targeted rebuild driven by a single file change. Walks `entryDeps` to find
   * every page whose dep graph contains `changedPath`, force-recompiles them
   * with the client-bundle deferral flag set, then runs one trailing
   * `buildClientBundle()`.
   *
   * The old `compiledComponents` entry stays in place until `compile()` swaps
   * it via the trailing `set()` — concurrent `renderComponent` calls keep
   * serving the previous module, never see a missing entry, and never trigger
   * a parallel Bun.build that would race on the SSR output file.
   *
   * Returns an empty `pages` set when the path isn't in any dep graph and
   * isn't itself a registered entry — the caller can use that to skip the
   * client reload for edits to files outside the page graph (server-entry,
   * package.json, etc.), where a full rebuild wouldn't take effect anyway
   * without a process restart.
   *
   * Paths in `pages` are absolute so they match the `window.__mochi_page_entry`
   * value injected into SSR'd HTML (used by the dev WS to reload only tabs on
   * affected pages).
   */
  async recompileChanged(changedPath: string): Promise<{ pages: Set<string>; clientBundleCount: number }> {
    const changed = path.resolve(changedPath);
    // Keep `affected` keyed as-stored in `compiledComponents` / `entryDeps`
    // (real callers register with relative paths, e.g. `./src/Site.svelte`),
    // so `compileAll()` looks up the correct key. Only the public return
    // value resolves to absolute, to match `__mochi_page_entry`.
    const affected = new Set<string>();
    if (this.compiledComponents.has(changed)) {
      affected.add(changed);
    }
    for (const [entry, deps] of this.entryDeps) {
      if (deps.has(changed)) {
        affected.add(entry);
      }
    }
    if (affected.size === 0) {
      return { pages: new Set(), clientBundleCount: 0 };
    }

    this.clientBundleCallCount = 0;
    // Rebuild every affected entry in a single Bun.build so transitive deps
    // dedupe across them.
    await this.safeBatchCompile([...affected], 'Targeted rebuild failed');
    this.rebuildHydratables();
    // `compileAll` already calls `buildClientBundle` once when the cohort
    // contributes any hydratables. Only force a trailing call when this
    // recompile *removed* the cohort's hydratables but the registry still
    // has hydratables from other cached pages — the client bundle then
    // needs to drop the stale entries.
    if (this.hydratableComponents.length > 0 && this.clientBundleCallCount === 0) {
      await this.buildClientBundle();
    }
    const pages = new Set([...affected].map((p) => path.resolve(p)));
    return { pages, clientBundleCount: this.clientBundleCallCount };
  }

  /**
   * Clear the cache and eagerly re-compile every page that was previously
   * compiled. Used by the dev watcher so the live-reload signal only fires
   * after client JS chunks are rebuilt — otherwise browsers race the build
   * and 404 on chunk requests.
   *
   * The client bundle is deferred to a single trailing call: without the flag,
   * each page's tail `buildClientBundle()` would rebuild the same monolithic
   * bundle once per page (O(N²) work for a single save).
   *
   * Returns a small summary so the dev watcher can include the affected
   * `pages` set / `clientBundleCount` in its `recompile:complete` event.
   * Paths in `pages` are absolute (matches the `recompileChanged` contract).
   */
  async recompileAll(): Promise<{ pages: Set<string>; clientBundleCount: number }> {
    const pageFiles = [...this.compiledComponents.keys()];
    this.clientBundleCallCount = 0;
    if (pageFiles.length === 0) {
      return { pages: new Set(), clientBundleCount: 0 };
    }
    await this.safeBatchCompile(pageFiles, 'Rebuild failed');
    this.rebuildHydratables();
    if (this.hydratableComponents.length > 0 && this.clientBundleCallCount === 0) {
      await this.buildClientBundle();
    }
    return { pages: new Set(pageFiles.map((f) => path.resolve(f))), clientBundleCount: this.clientBundleCallCount };
  }

  /** Serialize registry state into a manifest for the prebuild step. */
  toManifest(): MochiManifest {
    const outDirAbs = path.resolve(this.outDir);
    // Every artifact the runtime reads from disk lives under outDir, so storing
    // paths outDir-relative makes the build output relocatable ("build here,
    // deploy there"). Anything that somehow escapes outDir stays absolute —
    // fromManifest() passes absolute paths through untouched. On Windows a
    // different-drive target makes path.relative() return an absolute path,
    // which escapes without a leading `..` — hence the isAbsolute check too.
    const relToOutDir = (p: string): string => {
      const abs = path.resolve(p);
      const rel = path.relative(outDirAbs, abs);
      const escapes = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
      return toPosixPath(escapes ? abs : rel);
    };

    const components: MochiManifest['components'] = {};
    for (const [filename, entry] of this.compiledComponents) {
      components[filename] = {
        ssrModule: relToOutDir(entry.ssrPath),
        hydratables: entry.hydratables.map((h) => ({
          name: h.name,
          displayName: h.displayName,
          resolvedPath: h.resolvedPath,
          exportName: h.exportName,
        })),
        cssComponents: [...entry.cssComponents],
      };
    }

    const clientFiles: Record<string, string> = {};
    const clientPrefix = `${this.assetPrefix}/client/`;
    const cssPrefix = `${this.assetPrefix}/css/`;
    const importCssPrefix = `${this.assetPrefix}/import-css/`;
    for (const [urlPath] of this.clientFiles) {
      if (urlPath.startsWith(clientPrefix)) {
        clientFiles[urlPath] = path.posix.join('svelte-client', path.basename(urlPath));
      } else if (urlPath.startsWith(cssPrefix)) {
        clientFiles[urlPath] = path.posix.join('svelte-css', path.basename(urlPath));
      } else if (urlPath.startsWith(importCssPrefix)) {
        clientFiles[urlPath] = path.posix.join('import-css', path.basename(urlPath));
      }
    }

    const manifest: MochiManifest = {
      version: MANIFEST_VERSION,
      assetPrefix: this.assetPrefix,
      bootstrapUrl: this.islandBootstrapUrl,
      componentEntryUrls: Object.fromEntries(this.componentEntryUrls),
      cssFileUrls: Object.fromEntries(this.cssFileUrls),
      clientFiles,
      components,
      stats: this.getClientStats(),
      serverIslandPaths: Object.fromEntries(this.serverIslandPaths),
    };
    if (this.serverIslandExports.size > 0) {
      manifest.serverIslandExports = Object.fromEntries(this.serverIslandExports);
    }
    if (this.publicFiles.size > 0) {
      manifest.publicFiles = Object.fromEntries([...this.publicFiles].map(([urlPath, diskPath]) => [urlPath, relToOutDir(diskPath)]));
    }
    if (this.localImageAssets.size > 0) {
      manifest.localImageAssets = Object.fromEntries([...this.localImageAssets].map(([url, asset]) => [url, { ...asset, diskPath: relToOutDir(asset.diskPath) }]));
    }
    if (this.importedCssUrls.size > 0) {
      manifest.importedCssUrls = Object.fromEntries(this.importedCssUrls);
    }
    if (this.entryImportedCss.size > 0) {
      manifest.entryImportedCss = Object.fromEntries([...this.entryImportedCss].map(([k, v]) => [k, [...v]]));
    }
    if (this.serverIslandScriptFile) {
      manifest.serverIslandScript = relToOutDir(this.serverIslandScriptFile);
    }
    return manifest;
  }

  /** Load a registry from a prebuilt manifest (production mode). */
  static async fromManifest(manifestPath: string, development: boolean = false, outDir?: string): Promise<ComponentRegistry> {
    const raw = await Bun.file(manifestPath).text();
    const manifest: MochiManifest = JSON.parse(raw);

    const registryOutDir = outDir ?? path.dirname(manifestPath);
    // build() always writes manifest.json at the out-dir root, so the manifest's
    // own directory *is* the build out-dir — resolving v2 paths against it makes
    // the pairing intrinsic and can't be desynced by a mismatched `outDir`
    // option. v1 manifests stored absolute paths for some fields and cwd-relative
    // for others — keep both booting.
    const artifactRoot = path.dirname(path.resolve(manifestPath));
    const resolveManifestPath = (p: string): string => {
      if (path.isAbsolute(p)) {
        return p;
      }
      return manifest.version >= 2 ? path.resolve(artifactRoot, p) : path.resolve(p);
    };

    if (manifest.version > MANIFEST_VERSION) {
      logger.warn(
        `Manifest version ${manifest.version} is newer than this runtime supports (v${MANIFEST_VERSION}) — reading it with v${MANIFEST_VERSION} rules. Upgrade mochi-framework if the app fails to boot.`,
      );
    }

    const registry = new ComponentRegistry({
      development,
      outDir: registryOutDir,
      assetPrefix: manifest.assetPrefix,
    });
    registry.loadedFromManifest = true;

    registry.islandBootstrapUrl = manifest.bootstrapUrl;
    registry.clientStats = manifest.stats;

    for (const [name, url] of Object.entries(manifest.componentEntryUrls)) {
      registry.componentEntryUrls.set(name, url);
    }

    for (const [componentPath, cssUrl] of Object.entries(manifest.cssFileUrls)) {
      registry.cssFileUrls.set(componentPath, cssUrl);
    }

    // Load all client files (JS + CSS) from disk into memory
    for (const [urlPath, diskPath] of Object.entries(manifest.clientFiles)) {
      const content = await Bun.file(resolveManifestPath(diskPath)).text();
      registry.clientFiles.set(urlPath, content);
    }

    // Restore side-effect CSS import mappings
    if (manifest.importedCssUrls) {
      for (const [cssPath, url] of Object.entries(manifest.importedCssUrls)) {
        registry.importedCssUrls.set(cssPath, url);
      }
    }
    if (manifest.entryImportedCss) {
      for (const [entryPath, cssPaths] of Object.entries(manifest.entryImportedCss)) {
        registry.entryImportedCss.set(entryPath, new Set(cssPaths));
      }
    }

    // Load SSR modules and populate compiledComponents
    for (const [filename, entry] of Object.entries(manifest.components)) {
      const modulePath = resolveManifestPath(entry.ssrModule);
      const mod = await import(Bun.pathToFileURL(modulePath).href);
      // Manifests written before exportName existed omit it — those islands are
      // all default imports, so normalize before anything indexes on it.
      const hydratables = entry.hydratables.map((h) => ({ ...h, exportName: h.exportName ?? 'default' }));
      registry.compiledComponents.set(filename, {
        module: mod,
        cssComponents: new Set(entry.cssComponents),
        hydratables,
        ...indexHydratables(hydratables),
        ssrPath: modulePath,
      });
      registry.hydratableComponents.push(...hydratables);
    }

    // Load server island paths from manifest
    if (manifest.serverIslandPaths) {
      for (const [name, resolvedPath] of Object.entries(manifest.serverIslandPaths)) {
        registry.serverIslandPaths.set(name, resolvedPath);
      }
    }
    if (manifest.serverIslandExports) {
      for (const [name, exportName] of Object.entries(manifest.serverIslandExports)) {
        registry.serverIslandExports.set(name, exportName);
      }
    }

    // Load public file mappings from manifest. Store resolved absolute paths so
    // the runtime's Bun.file() reads are independent of the deployed layout.
    if (manifest.publicFiles) {
      for (const [urlPath, diskPath] of Object.entries(manifest.publicFiles)) {
        registry.publicFiles.set(urlPath, resolveManifestPath(diskPath));
      }
    }

    // Restore locally-imported image assets and repopulate the global request-time
    // registry so the serving process can stream/transform them from disk.
    if (manifest.localImageAssets) {
      for (const [url, asset] of Object.entries(manifest.localImageAssets)) {
        const diskPath = resolveManifestPath(asset.diskPath);
        registry.localImageAssets.set(url, { ...asset, diskPath });
        registerLocalImageAsset(url, { diskPath, contentType: asset.contentType });
      }
    }

    // Restore the prebuilt ServerIsland inline script so the runtime skips Bun.build.
    if (manifest.serverIslandScript) {
      registry.serverIslandClientJs = await Bun.file(resolveManifestPath(manifest.serverIslandScript)).text();
    }

    return registry;
  }
}
