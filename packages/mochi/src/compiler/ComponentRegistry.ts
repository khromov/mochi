import { preprocess as sveltePreprocess, type CompileOptions, type PreprocessorGroup } from 'svelte/compiler';
import { render } from 'svelte/server';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { BunPlugin } from 'bun';
import {
  isSvelteMarker,
  normalizeAssetPrefix,
  normalizeIslandHydrationMarkers,
  relForDisplay,
  resolveArgsPath,
  stripHydrationMarkers,
  toCompileErrorLogs,
  toPosixPath,
} from '../utils';
import { injectIslandPropsBlock } from '../islands/islandPropsRegistry';
import { requestContext, renderDetached } from '../runtime/requestContext';
import type { DebugBarData } from '../runtime/requestContext';
import { logger } from '../utils/log';
import { mochiEvents } from '../events';
import { detectHeavyBarrels, formatBarrelLine, formatBarrelSummary, type BarrelMetafile, type HeavyBarrel } from './barrelDetect';
import type { MarkdownConfig, MochiBarrelWarningOptions, MochiFontOptions, MochiManifest, MochiSvelteShakerOptions } from '../types';
import {
  adoptEmittedFontAssets,
  classifyFontAssets,
  createFontMarkerPlugin,
  fontAssetFileName,
  fontChangedSinceResolved,
  fontContentHash,
  substituteFontUrls,
} from './cssFontAssets';
import { type HydratableComponent, type PreprocessIslandError, type ServerIslandComponent } from './svelteAstPreprocess';
import { cachedPreprocessHydratable, createPreprocessCacheStats } from './preprocessCache';
import { CompileCache, compileFingerprint, createCompileCacheStats, type CompileCacheStats } from './compileCache';
import { mergeCompilerOptions, type MochiSvelteConfig } from './svelteConfig';
import { backendId, resolveSvelteCompiler, type MochiSvelteCompiler, type SvelteCompilerBackend } from './svelteCompilerBackend';
import { applyFilter } from '../extensions';
import { decodeSourcePath, encodeSourcePath } from './manifestPaths';
import { buildServerOnlyStubModule, scanServerOnlyExports } from './serverOnlyScan';
import { CLIENT_BUILD_DEFINE, serverOnlyModuleGuard } from './serverOnlyModuleGuard';
import { registerServerOnlyComponentStubs, SSR_ONLY_COMPONENT_NAMESPACE } from './serverOnlyComponents';
import { cleanInputs, SERVER_ONLY_MODULE_NAMESPACE } from './bundleInputPaths';
import { renderMochiEnvServer } from './virtualModuleTemplate';
import { buildDebugBarBundle, type DebugBarBundle } from './buildDebugBarBundle';
import { formatBuildMessages } from './formatBuildMessages';
import { registerEsmEnvStrip, registerMochiEnvClient, registerSvelteModuleLoader } from './clientBuildLoaders';
import { createImageAssetLoader, IMAGE_FILE_FILTER } from './imageAssetLoader';
import { EMAIL_TEMPLATE_DIR } from '../email/templates';
import { registerLocalImageAsset } from '../image/localAssetRegistry';
import type { LocalImageAsset } from '../image/types';
import { freshImport } from './freshImport';
import { resolveSvelteShaker } from './svelteShaker';
import prettyBytes from '../vendor/pretty-bytes';

// The `compile:preprocessors` filter is sync; only applying its preprocessors through Svelte's `preprocess()` is async.
async function applyUserPreprocessors(source: string, filename: string, target: 'server' | 'client', development: boolean): Promise<string> {
  const userPreprocessors: PreprocessorGroup[] = applyFilter('compile:preprocessors', [], {
    filename,
    target,
    development,
  });
  // `builtinTsPreprocessor` runs last so it also strips TS that user preprocessors emit, and it decides TS-ness from the
  // parsed `attributes` Svelte hands each hook.
  //
  // With no user preprocessors, that builtin pass is the only work left and it fires solely on `attributes.lang === 'ts'`.
  // A `lang="ts"` attribute always contains the literal substring `lang` whatever the quoting, so the gate below can only
  // false-positive — harmlessly re-parsing a "lang"-containing plain-JS file — and skips the full parse for plain JS.
  if (userPreprocessors.length === 0 && !source.includes('lang')) {
    return source;
  }
  const result = await sveltePreprocess(source, [...userPreprocessors, builtinTsPreprocessor], { filename });
  return result.code;
}

// Svelte 5's native TS stripping is incomplete — it throws on constructor parameter properties — so Bun's transpiler runs
// over `<script lang="ts">` first, the same treatment the `.svelte.[jt]s` rune-module loaders apply. `transformSync` leaves
// tree-shaking alone, so value imports referenced only in the template survive.
const tsScriptTranspiler = new Bun.Transpiler({ loader: 'ts' });
const builtinTsPreprocessor: PreprocessorGroup = {
  name: 'mochi-ts',
  script({ content, attributes }) {
    if (attributes.lang !== 'ts') {
      return;
    }
    // `lang="ts"` must STAY on the tag: it also puts the template in TS mode (snippet parameter types, `as` casts in
    // markup), which Bun never sees, so dropping it makes svelte parse those as plain JS and fail. `transformSync` emits
    // no source map, so positions after a transpiled script drift by its reprinted line-count delta.
    return { code: tsScriptTranspiler.transformSync(content) };
  },
};

// Climbs one level out of `src/compiler/`, so every path built from SRC_DIR below reads relative to `src/`, matching the
// layout on disk and in the published package.
const SRC_DIR = path.join(path.dirname(Bun.fileURLToPath(import.meta.url)), '..');

/** Manifest schema version this runtime writes; see `MochiManifest.version` for the path families it implies. */
const MANIFEST_VERSION = 3;

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
    // A hit replays the side effects the miss path would have produced (hydration metadata, scoped CSS) and skips mdsvex
    // and the svelte compile. Keying on raw source assumes mdsvex and the user preprocessors are pure in
    // (source, filename), the standard Vite/SvelteKit contract: a plugin reading a sibling `.json` won't re-run until
    // this file's own bytes change.
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
    // mdsvex passes `<script lang="ts">` through untouched, so its output needs the same built-in TS pass as a regular
    // `.svelte` file, behind the same safe `lang` fast-path as `applyUserPreprocessors`.
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
      kind: 'defer-in-hydratable';
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
    }
  | {
      kind: 'server-only-island';
      component: string;
      directive: string;
      filePath: string;
      resolvedPath: string;
    }
  | {
      kind: 'hydrate-island-children';
      component: string;
      directive: string;
      filePath: string;
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

function formatCompileError(e: MochiCompileError): string {
  switch (e.kind) {
    case 'nested-hydration':
      return `Nested mochi:hydrate: <${e.child}> inside <${e.parent}> — remove mochi:hydrate from ${e.child}`;
    case 'defer-in-hydratable':
      return `mochi:defer inside a hydratable: <${e.child}> is a server island inside <${e.parent}>, whose subtree re-renders on the client where a server island cannot exist — remove mochi:defer from ${e.child} or the hydrate/clientOnly directive from ${e.parent}`;
    case 'css-bundle-failed':
      return `CSS bundle failed: ${e.cssPath} — ${e.message}`;
    case 'unresolved-island':
      return formatUnresolvedIsland(e);
    case 'server-only-island':
      return (
        `Server-only island: <${e.component} ${e.directive}> in ${relForDisplay(e.filePath)} — ${relForDisplay(e.resolvedPath)} is a \`.server.svelte\`, ` +
        `which the client build replaces with a throwing stub, so it cannot hydrate. Remove the ${e.directive} directive (it already renders server-side), ` +
        `use mochi:defer, or drop the .server suffix if it must ship to the client.`
      );
    case 'hydrate-island-children':
      return (
        `Island children: <${e.component} ${e.directive}> in ${relForDisplay(e.filePath)} has children, which cannot cross the server→client boundary — ` +
        `the island hydrates from its serialized props alone, so server-rendered children would vanish on hydration. ` +
        `Move the markup inside ${e.component} or pass it as serializable props; with mochi:defer or mochi:clientOnly, children are the loading fallback instead.`
      );
  }
}

export function formatCompileErrors(errors: MochiCompileError[]): string {
  const header = `${errors.length} compile error${errors.length === 1 ? '' : 's'}:`;
  return `${header}\n${errors.map((e) => `• ${formatCompileError(e)}`).join('\n')}`;
}

export interface RenderResult {
  body: string;
  head: string;
  cssUrls: string[];
  /** Served URLs of preload-worthy fonts extracted from this entry's CSS imports; the shell may emit `<link rel="preload">` for them. */
  fontPreloadUrls: string[];
  bootstrapUrl: string | null;
  hasServerIslands: boolean;
  /** Dev-only snapshot of `ctx.debugBarData`, taken at end of render before the per-request bag is cleared and surfaced to the toolbar as `window.__mochi_debug`. */
  debugBarData?: DebugBarData;
}

/** Result of {@link ComponentRegistry.renderStatic}, the stateless render path used for email: plain HTML and CSS, with no islands, shell, or request state. */
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
  /** See `MochiServeOptions.barrelWarnings`. */
  barrelWarnings?: boolean | MochiBarrelWarningOptions;
  /** See `MochiServeOptions.fonts`. */
  fonts?: MochiFontOptions;
  /**
   * Buffers barrel offenders so a one-shot `mochi-framework build` can emit them as one grouped summary via
   * `flushBarrelWarnings()`. A live server compiles lazily with no end-of-build flush point, so buffered warnings
   * would never surface there. Default: `false`.
   */
  bufferBarrelWarnings?: boolean;
}

// Runs once per compiled-component entry (compileAll / fromManifest) so renderComponent reads these lookups instead of
// rebuilding three collections on every render.
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
   * Prebuilt, minified ServerIsland inline web-component script, set by `build()` and restored by `fromManifest` so the
   * runtime skips the startup `Bun.build`. Left undefined where `Mochi.serve()` builds it on demand instead.
   */
  serverIslandClientJs?: string;
  /** Disk path recorded for the manifest; see `serverIslandClientJs`. */
  private serverIslandScriptFile?: string;
  private componentEntryUrls: Map<string, string> = new Map();
  private islandBootstrapUrl: string | null = null;
  private debugBarUrl: string | null = null;
  private debugBarBundle: DebugBarBundle | null = null;
  private debugBarBuildPromise: Promise<DebugBarBundle> | null = null;
  private clientFiles: Map<string, string> = new Map();
  /** Maps component file path → CSS URL */
  private cssFileUrls: Map<string, string> = new Map();
  /**
   * Last-extracted raw CSS per component path, letting `compileAll`'s write-CSS-files loop decide on content equality
   * rather than mere presence in `cssFileUrls` — otherwise an HMR recompile of a child short-circuits and leaves the stale hashed URL.
   */
  private cssRawByPath: Map<string, string> = new Map();
  /** Maps resolved CSS-import path → served URL (e.g. /import-css/inter-<hash>.css) */
  private importedCssUrls: Map<string, string> = new Map();
  /** Maps page entry .svelte path → set of resolved CSS-import paths reachable from it */
  private entryImportedCss: Map<string, Set<string>> = new Map();
  /**
   * Maps page entry path → every absolute file that contributed to its SSR bundle, taken from Bun's metafile, so the dev
   * watcher's `recompileChanged()` invalidates only the pages whose dep graph contains the changed file.
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
  /** Maps served asset URL → emitted asset for locally-imported images (`import x from './x.png'`). */
  private localImageAssets: Map<string, LocalImageAsset> = new Map();
  /** Maps served font URL → binary font extracted from a bundled CSS import's `data:` URIs. */
  private fontAssets: Map<string, { diskPath: string; contentType: string }> = new Map();
  /** Superseded font URLs, kept so dev HTML rendered before a re-bundle keeps resolving them. */
  private readonly devStaleFontAssets: Map<string, { diskPath: string; contentType: string }> = new Map();
  /** Maps served URL → non-font asset Bun emitted beside a bundled stylesheet; content-hashed by the bundler, so never retired. */
  private readonly importCssAssets: Map<string, { diskPath: string; contentType: string }> = new Map();
  /** Maps resolved CSS-import path → served URLs of its preload-worthy extracted fonts (woff2, latin-visible). */
  private importedCssFontPreloads: Map<string, string[]> = new Map();
  /** Tail of the serialized `bundleImportedCss` chain; see the comment there for why batches may not overlap. */
  private importedCssBatches: Promise<unknown> = Promise.resolve();
  readonly development: boolean;
  /** Set by `fromManifest()`; distinguishes a prebuilt-manifest boot from a live, compile-on-demand one. */
  loadedFromManifest = false;
  /** Files `publicDir` held when this manifest was built; see `MochiManifest.publicFileCount`. 0 when not loaded from one. */
  publicFileCountAtBuild = 0;
  readonly debugBarEnabled: boolean;
  readonly outDir: string;
  readonly assetPrefix: string;
  svelteConfig: MochiSvelteConfig;
  private readonly svelteCompiler: MochiSvelteCompiler | undefined;
  readonly markdown: MarkdownConfig | undefined;
  readonly optimize: boolean | MochiSvelteShakerOptions;
  private readonly fontInlineThreshold: number;
  private readonly fontDropLegacyWoff: boolean;
  private readonly barrelWarningsEnabled: boolean;
  private readonly barrelIgnore: Set<string>;
  private readonly barrelMinBytes: number;
  private readonly barrelBuffering: boolean;
  /** Packages already warned about this process, so the warning fires once, not on every rebuild. */
  private readonly warnedBarrels = new Set<string>();
  private readonly warnedRetainedStubs = new Set<string>();
  /** Buffer used when `bufferBarrelWarnings` is on: barrels collected across the build, flushed as one grouped summary by `flushBarrelWarnings()`. */
  private pendingBarrels: HeavyBarrel[] = [];
  /** absPath → slimmed `.svelte` source from the last `prepareShake()`; empty when shaking is off. */
  private shakenSources: Map<string, string> = new Map();
  private errors: MochiCompileError[] = [];
  /** Bumped each time `buildClientBundle()` runs; read+reset by `recompileAll()`. */
  private clientBundleCallCount = 0;
  /** Instance-scoped so two registries with different markdown/preprocessor config can't serve each other stale output for the same path — see {@link CompileCache}. */
  readonly compileCache = new CompileCache();

  constructor(opts: ComponentRegistryOptions = {}) {
    this.development = opts.development ?? true;
    this.debugBarEnabled = this.development && (opts.debugBar ?? true);
    // A relative outDir resolves against whoever's cwd asks, and compile and `toManifest()` ask at different moments, so
    // a `process.chdir()` in between would make every artifact look like it escaped the out-dir and bake absolute paths
    // into an otherwise relocatable build.
    this.outDir = path.resolve(opts.outDir ?? './.mochi');
    this.assetPrefix = normalizeAssetPrefix(opts.assetPrefix);
    this.svelteConfig = opts.svelteConfig ?? {};
    this.svelteCompiler = opts.svelteCompiler;
    this.markdown = opts.markdown;
    this.optimize = opts.optimize ?? false;
    this.fontInlineThreshold = opts.fonts?.inlineThreshold ?? 4096;
    this.fontDropLegacyWoff = opts.fonts?.dropLegacyWoff ?? true;
    const bw = opts.barrelWarnings;
    this.barrelWarningsEnabled = bw !== false;
    this.barrelIgnore = new Set(typeof bw === 'object' ? (bw.ignore ?? []) : []);
    this.barrelMinBytes = (typeof bw === 'object' ? bw.minBytes : undefined) ?? 50 * 1024;
    this.barrelBuffering = opts.bufferBarrelWarnings ?? false;
  }

  /**
   * Runs the whole-program svelte-shaker pass and caches the slimmed source for the compile `onLoad` handlers. A no-op
   * in dev, where per-file HMR can't safely reuse a one-time whole-program shake, and any failure falls back to
   * unshaken disk reads rather than breaking the build.
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
    // Outside the try because a missing add-on is a config problem, not an engine bug: the loader already warned once
    // with install instructions, and `shakenSources` is already the empty map every onLoad falls back through.
    const backend = await resolveSvelteShaker();
    if (!backend) {
      return;
    }
    try {
      const { shaken, originals } = await backend.shakeApp(appRoot);
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

      // The shake map holds every in-scope component, returning untouched ones verbatim, so its size is the scan count.
      // Diffing against the originals the engine already read finds what was actually slimmed without a second disk pass.
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
      // Naming the engine version matters because it is declared as a `>=` floor: a regressed release can reach users.
      logger.warn(
        `svelte-shaker: this looks like a ${backend.name}@${backend.version} bug — please report it with the error below at https://github.com/baseballyama/svelte-shaker/issues`,
      );
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
    return this.cssFileUrls.get(path.resolve(componentPath));
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
   * Compile a single page entrypoint, delegating to `compileAll` so a lazy caller (`renderComponent`, a server-island
   * fetch) can trigger one compile in isolation. Boot-time and dev-watcher paths should call `compileAll` with the full
   * entrypoint set instead, which yields one shared SSR bundle via Bun's `splitting: true`.
   */
  async compile(filename: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.compileAll([filename], opts);
  }

  evict(componentPath: string): void {
    const key = path.resolve(componentPath);
    this.compiledComponents.delete(key);
    this.entryDeps.delete(key);
    this.entryImportedCss.delete(key);
  }

  isCompiled(componentPath: string): boolean {
    return this.compiledComponents.has(path.resolve(componentPath));
  }

  /**
   * Compile a cohort of page entrypoints in one `Bun.build` with `splitting: true`, so shared transitive deps land in
   * chunk files alongside each `<basename>.server.js` and are emitted exactly once across the cohort.
   */
  async compileAll(filenames: string[], opts: { force?: boolean; deferClientBundle?: boolean } = {}): Promise<void> {
    // Every source-keyed map uses the resolved absolute path, so a component registered as `./src/X.svelte` or as an
    // absolute path hits the same entry, including entries restored from a manifest built elsewhere.
    const resolved = [...new Set(filenames.map((f) => path.resolve(f)))];
    const todo = opts.force ? resolved : resolved.filter((f) => !this.compiledComponents.has(f));
    if (todo.length === 0) {
      return;
    }

    // A prebuilt manifest is meant to cover every component the app renders, so a miss costs a cold compile on the
    // request that hit it — and means this deploy needs its Svelte sources and the compiler at runtime.
    if (this.loadedFromManifest && !this.development && !opts.force) {
      logger.warn(
        `${todo.length} component(s) are missing from the prebuilt manifest and will be compiled now:\n` +
          todo.map((f) => `  - ${relForDisplay(f)}`).join('\n') +
          `\nCommon causes: an email template outside \`${EMAIL_TEMPLATE_DIR}/\` (the build walks that directory, since nothing imports a template from a route — move it there), ` +
          `or another component rendered outside a route, which the build cannot discover. ` +
          `Otherwise, \`mochi-framework build\` and the server must run from the same working directory (the project root), and both must use the same mochi-framework version. ` +
          `Until it's fixed, this build needs its Svelte sources and the compiler at runtime. ` +
          `If none of the above apply, this is a Mochi bug — please report it with a reproduction.`,
      );
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
        // Bun resolves bare specifiers like `@fontsource-variable/inter` through package.json#main to the real `.css`,
        // so filtering on the resolved path catches direct and package imports alike. The path is recorded and the import
        // stripped from the SSR JS bundle; the CSS is bundled out-of-band below and served as `/import-css/*`.
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
          contents: [
            `import { encryptProps } from "${toPosixPath(path.join(SRC_DIR, 'islands/serverIslandCrypto.ts'))}";`,
            `import { shouldInlineIsland } from "${toPosixPath(path.join(SRC_DIR, 'islands/inlineServerIslands.ts'))}";`,
            `export { encryptProps, shouldInlineIsland };`,
          ].join('\n'),
          loader: 'js',
        }));
        // The preprocessor's island wrapper resolves to the framework's own component in the default namespace, so it
        // flows through the normal `.svelte` loader below. The specifier is a subpath of a package we own but is kept out
        // of the exports map, so outside this plugin it fails to resolve instead of fetching a squattable third-party name.
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
      entrypoints: todo,
      plugins: [sveltePlugin],
      target: 'bun',
      conditions: ['svelte'],
      // Svelte stays external as a peer dep the consumer already provides; everything else bundles, and `splitting: true`
      // emits shared transitive deps into chunk files written once across the cohort.
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

    // Detection recomputes nested-hydration and unresolved-island errors for every file in this batch, so prior ones for
    // the recompiled files are dropped first — otherwise a fixed mistake keeps 500-ing every page until a restart and an
    // unfixed one is duplicated on every save.
    //
    // This runs BEFORE the `result.success` throw on purpose: the hydration maps come from the svelte `onLoad`, which
    // fires for every entry before Bun resolves transitive JS deps, so a later bundler failure must not swallow a
    // structural error already detected — including under the `bun test`-only EISDIR bug, where the SSR build fails
    // after preprocessing succeeded.
    this.errors = this.errors.filter(
      (e) =>
        !(e.kind === 'nested-hydration' && fileHydratables.has(e.parentPath)) &&
        !(e.kind === 'defer-in-hydratable' && fileServerIslands.has(e.parentPath)) &&
        !((e.kind === 'unresolved-island' || e.kind === 'server-only-island' || e.kind === 'hydrate-island-children') && filePreprocessErrors.has(e.filePath)),
    );

    for (const errors of filePreprocessErrors.values()) {
      for (const err of errors) {
        let compileError: MochiCompileError;
        switch (err.reason) {
          case 'server-only':
            compileError = { kind: 'server-only-island', component: err.component, directive: err.directive, filePath: err.filePath, resolvedPath: err.resolvedPath };
            break;
          case 'hydrate-children':
            compileError = { kind: 'hydrate-island-children', component: err.component, directive: err.directive, filePath: err.filePath };
            break;
          case 'unresolved':
            compileError = { kind: 'unresolved-island', component: err.component, directive: err.directive, filePath: err.filePath, importSource: err.importSource };
            break;
        }
        this.errors.push(compileError);
        logger.error(`\n${formatCompileError(compileError)}\n`);
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

    // A server island inside a hydratable subtree can never work: client bundles skip the island preprocessor, so on
    // hydration the client renders the raw child where SSR emitted a placeholder (observed: HYDRATION_ERROR + client
    // remount wiping the island). Same one-file-deep limitation as the nested-hydration guard above.
    for (const [filePath, children] of fileServerIslands) {
      if (hydratablePaths.has(filePath) && children.length > 0) {
        const parent = allHydratables.find((h) => h.resolvedPath === filePath)!;
        for (const child of children) {
          this.errors.push({
            kind: 'defer-in-hydratable',
            parent: parent.displayName,
            child: child.displayName,
            parentPath: filePath,
            childPath: child.resolvedPath,
          });
          logger.error(
            `\nA server island cannot sit inside a hydratable subtree.\n  <${child.displayName}> with mochi:defer or mochi:defer:visible is inside <${parent.displayName}>, which hydrates on the client — where a server island cannot render.\n  Remove mochi:defer from ${child.displayName}, or the hydrate/clientOnly directive from ${parent.displayName}.\n`,
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

    // Attribution walks Bun's output graph: `outputs[outKey].inputs` is a flat record of every source file that fed that
    // chunk, keyed in the same shape as `inputs[]` and so stable to compare against `cssMap` / `importedCssPaths`. The
    // source-import walk via `inputs[].imports[].path` is unusable, since Bun stores those importer-relative and
    // `path.resolve` against cwd fabricates absolutes that miss `inputs[]`, killing the BFS one hop in.
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
      const outKey = entryToOutKey.get(filename);
      if (!outKey) {
        throw new Error(`Svelte SSR build produced no output for ${filename}`);
      }

      // Entry names are hashed, so the on-disk filename can't be derived from the source basename; the metafile key
      // carries the real one, and only its basename matters here.
      const outPath = path.join(compileOutDir, path.basename(outKey));

      // Dev rebuilds re-import the same on-disk entry, and Bun's query-string cache-busting returns the stale module on
      // Windows, so `freshImport` copies the entry to a unique path for a guaranteed cache miss. Production compiles each
      // entry once, so a direct import suffices.
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
   * Trailing client bundle for callers batching several `compileAll` passes with `deferClientBundle` — the CLI build
   * compiles pages, then server islands, and without deferral each pass rebuilds the same monolithic bundle.
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

    // Local maps swap into the instance fields only once the build succeeds, so a failed `Bun.build` leaves the registry
    // intact rather than 404-ing island JS until the next good build. CSS entries in `clientFiles` are per-component and
    // stable, so they survive the swap.
    const newClientFiles = new Map<string, string>();
    const newComponentEntryUrls = new Map<string, string>();
    let newIslandBootstrapUrl: string | null = null;

    // The debug bar builds standalone (production-mode Svelte, own runtime) and only once per process — framework
    // sources don't change under a running user app, so watcher rebuilds skip it entirely.
    if (debugBarEnabled && !this.debugBarBundle) {
      this.debugBarBuildPromise ??= buildDebugBarBundle({ development, backend });
      // If the main build below throws before the swap-time await, a rejection here would otherwise go unhandled.
      this.debugBarBuildPromise.catch(() => {});
    }

    const srcDir = SRC_DIR;
    // Forward slashes survive intact in generated source, where Windows backslashes get eaten as JS escapes, and keep a
    // file's module identity consistent across its three uses: `Bun.build` entrypoint, `filesMap` key, import specifier.
    const hydratableIslandPath = toPosixPath(path.join(srcDir, 'web-components', 'HydratableIsland.ts'));

    // Generate per-component virtual entry points
    const entrypoints: string[] = [hydratableIslandPath];
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
        // Mirrors the SSR side-effect-CSS strip, since the SSR-rendered `<head>` already links the bundle via
        // entryImportedCss → importedCssUrls. Bun's default CSS handling would otherwise inline JS-injected styles or
        // fail the build for any hydratable component importing a stylesheet.
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
        // `.server.ts` / `.server.js` files are stripped from the client graph into a virtual `mochi-server-only`
        // namespace whose onLoad emits a throwing-Proxy stub per discovered export, leaving the real file and its
        // `bun:*` / `node:*` deps to SSR alone. The extensionless form falls back to disk probing for the real sibling,
        // so the stub still names a canonical path.
        build.onResolve({ filter: /\.server(?:\.[jt]s)?$/ }, (args) => {
          const base = resolveArgsPath(args);
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
          return { path: resolved, namespace: SERVER_ONLY_MODULE_NAMESPACE };
        });
        build.onLoad({ filter: /.*/, namespace: SERVER_ONLY_MODULE_NAMESPACE }, async (args) => {
          const source = await Bun.file(args.path).text();
          const scan = scanServerOnlyExports(source);
          for (const w of scan.warnings) {
            logger.warn(`[mochi] ${relForDisplay(args.path)}: ${w}`);
          }
          return { contents: buildServerOnlyStubModule(relForDisplay(args.path), scan), loader: 'js' };
        });
        registerServerOnlyComponentStubs(build);
        registerMochiEnvClient(build, development);
        // Client builds never run the island preprocessor, so the injected
        // boundary import shouldn't appear in a client graph — this alias is
        // cheap insurance against a stray specifier failing the whole build.
        build.onResolve({ filter: /^mochi-framework\/hydratable-boundary$/ }, () => ({
          path: path.join(SRC_DIR, 'islands/HydratableBoundary.svelte'),
        }));
        registerEsmEnvStrip(build);
        registerSvelteModuleLoader(build, backend, mergeCompilerOptions(userCompilerOptions, { generate: 'client', dev: development }));
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
      // The guard goes first so its `onResolve` sees a server-only specifier
      // before any of the client plugin's own handlers can claim it.
      plugins: [serverOnlyModuleGuard, clientPlugin],
      target: 'browser',
      conditions: ['svelte', ...(development ? ['development'] : ['production'])],
      define: {
        DEV: String(development),
        BROWSER: 'true',
        NODE: 'false',
        ...CLIENT_BUILD_DEFINE,
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
      // entryPath → component name, with `null` for the bootstrap. Both sides go through the same
      // `toPosixPath(path.resolve(...))` because the entrypoints mix POSIX and native paths while Bun's metafile
      // entryPoint is native; on Windows the formats diverge, the bootstrap lookup misses, and the hydration `<script>` disappears.
      const entryToComponent = new Map<string, string | null>();
      entryToComponent.set(toPosixPath(path.resolve(hydratableIslandPath)), null);
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
      this.warnOnRetainedComponentStubs(result.metafile);
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

    if (this.debugBarBuildPromise && !this.debugBarBundle) {
      try {
        this.debugBarBundle = await this.debugBarBuildPromise;
      } catch (err) {
        // A rejected promise must not be memoized (the next rebuild retries), and a broken debug bar must not take
        // down page serving.
        this.debugBarBuildPromise = null;
        logger.warn(`[mochi] debug bar build failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (this.debugBarBundle) {
      const debugBarUrl = `${clientPrefix}${this.debugBarBundle.fileName}`;
      this.clientFiles.set(debugBarUrl, this.debugBarBundle.contents);
      this.debugBarUrl = debugBarUrl;
    } else {
      this.debugBarUrl = null;
    }

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
   * Stateless SSR for email templates. It leaves `ctx.islandProps` alone and runs outside any ambient request context, so
   * `getRequestContext()` throws inside the template whatever the call site and no page render can interleave. Islands are
   * a hard error, since email clients run no JS and can't make the follow-up request a deferred island needs.
   */
  async renderStatic(filename: string, props?: Record<string, unknown>): Promise<StaticRenderResult> {
    await this.compile(filename);
    const key = path.resolve(filename);
    const entry = this.compiledComponents.get(key);
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

    // Detached from any ambient request context (see `renderDetached`). body/head are read inside the callback so
    // materialization also happens in the cleared scope, returning plain strings rather than the live render object.
    const { body, head } = await renderDetached(async () => {
      const rendered = await render(mod.default, { ...(props ? { props } : {}), transformError });
      return { body: rendered.body, head: rendered.head };
    });

    let output = body;

    // Server-island guard (post-render): no per-entry metadata to check up
    // front, so detect the emitted placeholder in the rendered output.
    //
    // TODO: make this pre-render like the hydratable guard above. Post-render means a `mochi:defer` behind a branch
    // that never renders slips through here, so the "even behind a branch that never renders" promise in the email
    // docs holds only via the build's import-graph check — which a dev-mode app never runs. Needs `entryServerIslands`
    // stored on `compiledComponents` plus a manifest field so the prebuilt path carries it too, i.e. a schema change.
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
    const imported = this.entryImportedCss.get(key);
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
    const entryKey = path.resolve(filename);
    const { module: mod, cssComponents, hydratables, hydratablesByName, hydratablesByPath, islandPaths } = this.compiledComponents.get(entryKey)!;

    const development = this.development;
    const componentBaseName = path.basename(filename, path.extname(filename));
    // `transformError` is what makes `<svelte:boundary>` functional during SSR (Svelte 5.51+); without it boundaries are
    // server-side no-ops and one island throw takes down the page render. Returning an Error lets user `failed` snippets
    // use `error instanceof Error`, and `message` is made enumerable so it survives the `JSON.stringify` below while
    // `stack` stays non-enumerable and unleaked.
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
      // Svelte writes a sentinel comment at every boundary so client hydration knows which branch was rendered:
      //   <!--[-->          children rendered normally
      //   <!--[!-->         pending snippet (HYDRATION_START_ELSE)
      //   <!--[?<json>-->   failed snippet (HYDRATION_START_FAILED), thrown error JSON-stringified into <json>
      // The client parses `<json>` back out and re-runs the `failed` snippet with it during hydration. `message` is
      // non-enumerable by default, so without this `defineProperty` the stringify yields `{}` and the injected
      // `<mochi-island-failure data-message={error.message}>` hydrates with an empty message.
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

    // Each render owns the whole `islandProps` map: `emitIslandProps` fills it during this `render()` and the
    // HTMLRewriter pass below drains it, so clearing up front keeps sequential same-ctx renders self-contained — an
    // error page after a failed render, an action's POST re-render.
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

    // Track which islands are lazy (have CSS_URL placeholders) during replacement
    const lazyIslandPaths = new Set<string>();
    let hasServerCssPlaceholders = false;
    // Placeholders only exist in island wrapper attributes, so one probe spares island-free pages four full-body scans.
    if (output.includes('__MOCHI_')) {
      output = output.replace(/__MOCHI_COMPONENT_URL__(\w+)__/g, (_, name: string) => this.componentEntryUrls.get(name) ?? '');

      output = output.replace(/__MOCHI_CSS_URL__(\w+)__/g, (_, name: string) => {
        const h = hydratablesByName.get(name);
        if (h) {
          lazyIslandPaths.add(h.resolvedPath);
          return this.cssFileUrls.get(h.resolvedPath) ?? '';
        }
        return '';
      });

      output = output.replace(/__MOCHI_SERVER_CSS_URL__(\w+)__/g, (_, name: string) => {
        hasServerCssPlaceholders = true;
        const resolvedPath = this.serverIslandPaths.get(name);
        return resolvedPath ? (this.cssFileUrls.get(resolvedPath) ?? '') : '';
      });

      output = output.replaceAll('__MOCHI_ASSET_PREFIX__', this.assetPrefix);
    }

    const shouldStrip = opts?.stripMarkers !== false && hydratables.length === 0;
    const hasIslandsOrServerIslands = hydratables.length > 0 || hasServerCssPlaceholders;

    // Indexed by ref id so the rewriter below emits each payload as a `<script type="application/json">` block just
    // before the first island referencing it — HTMLRewriter visits elements in document order, so the first callback for
    // a given `props-ref` is that payload's first island. Byte-identical payloads share one block, tagged `data-shared`.
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
      let islandDepth = 0;
      const rewriter = new HTMLRewriter();
      if (hasIslandsOrServerIslands) {
        rewriter
          .on('mochi-hydratable-island', {
            element(el) {
              islandDepth++;
              el.onEndTag(() => {
                islandDepth--;
              });
              const raw = el.getAttribute('component-name');
              if (raw) {
                renderedIslandNames.add(raw);
              }
              injectIslandPropsBlock(el, propsById, emittedProps);
            },
          })
          .on('mochi-server-island', {
            element(el) {
              islandDepth++;
              el.onEndTag(() => {
                islandDepth--;
              });
              hasServerIslands = true;
            },
          });
      }
      if (shouldStrip) {
        rewriter.onDocument({
          comments(comment) {
            if (islandDepth === 0 && isSvelteMarker(comment.text)) {
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

        // Code splitting hoists anything two entries share into a `chunk-*.js`, but a chunk only
        // reaches the browser if one of *this page's* entries imports it. Walk the import graph
        // from the bootstrap plus the islands actually rendered here, so the panel reports (and
        // totals) the bytes the page really ships rather than every chunk in the build.
        const clientPrefix = `${this.assetPrefix}/client/`;
        const entryRoots: string[] = [];
        if (pageHasIslands && this.islandBootstrapUrl) {
          entryRoots.push(this.islandBootstrapUrl.slice(clientPrefix.length));
        }
        for (const name of renderedIslandNames) {
          const entryUrl = this.componentEntryUrls.get(name);
          if (entryUrl) {
            entryRoots.push(entryUrl.slice(clientPrefix.length));
          }
        }
        const reachable = ComponentRegistry.reachableOutputNames(entryRoots, outputByName);
        for (const output of this.clientStats.outputs) {
          const url = `${this.assetPrefix}/client/${output.name}`;
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
              inputs: cleanInputs(wcInputs),
            });
          } else {
            const compName = urlToComponent.get(url);
            const cleaned = cleanInputs(output.inputs);
            const nonWc = cleaned.filter((i) => !i.path.includes('web-components/'));
            const wcDeduct = cleaned.reduce((s, i) => s + (i.path.includes('web-components/') ? i.size : 0), 0);
            if (compName) {
              if (!renderedIslandNames.has(compName)) {
                continue;
              }
              bundles.push({ url, label: displayByKey.get(compName) ?? compName, sizeBytes: output.size - wcDeduct, kind: 'island', inputs: nonWc });
            } else {
              if (!reachable.has(output.name)) {
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
    // Deduped: two CSS imports sharing a font produce the same content-hashed URL, and a duplicate would burn one of
    // the FONT_PRELOAD_MAX slots.
    const fontPreloadUrls = new Set<string>();
    const imported = this.entryImportedCss.get(entryKey);
    if (imported) {
      for (const cssPath of imported) {
        const url = this.importedCssUrls.get(cssPath);
        if (url) {
          cssUrls.push(url);
        }
        const preloads = this.importedCssFontPreloads.get(cssPath);
        if (preloads) {
          for (const preloadUrl of preloads) {
            fontPreloadUrls.add(preloadUrl);
          }
        }
      }
    }

    // Collapse the doubled-marker Svelte SSR bug (`$state` arrays + `{@attach}`); only island wrappers can carry it,
    // so island-free renders skip the scan.
    const normalized = hydratables.length > 0 ? normalizeIslandHydrationMarkers(output) : output;
    const headStr = head ?? '';
    return {
      body: normalized,
      head: shouldStrip ? stripHydrationMarkers(headStr) : headStr,
      cssUrls,
      fontPreloadUrls: [...fontPreloadUrls],
      // Gated on wrappers actually present in the output — the entry's compile-time hydratables may all sit in branches
      // this render never took.
      bootstrapUrl: renderedIslandNames.size > 0 ? this.islandBootstrapUrl : null,
      hasServerIslands,
      debugBarData,
    };
  }

  /**
   * A `.server.svelte` stub retained with nonzero bytes means an island's live client code actually references the
   * component — it will throw the moment hydration reaches it, so say so at build time instead of leaving the first
   * signal to the user's browser console. The direct-directive case is a compile error upstream; this catches the
   * component nested anywhere deeper in an island's subtree.
   */
  private warnOnRetainedComponentStubs(metafile: BarrelMetafile | undefined): void {
    if (!metafile) {
      return;
    }
    for (const outMeta of Object.values(metafile.outputs)) {
      for (const [inputPath, inputMeta] of Object.entries(outMeta.inputs ?? {})) {
        if (!inputPath.startsWith(`${SSR_ONLY_COMPONENT_NAMESPACE}:`) || inputMeta.bytesInOutput === 0) {
          continue;
        }
        const componentPath = inputPath.slice(SSR_ONLY_COMPONENT_NAMESPACE.length + 1);
        if (this.warnedRetainedStubs.has(componentPath)) {
          continue;
        }
        this.warnedRetainedStubs.add(componentPath);
        logger.warn(
          `[mochi] ${relForDisplay(componentPath)} is rendered inside a hydrated island's client bundle; its client stub will throw at hydration. ` +
            `Render it outside the island, use mochi:defer, or drop the .server suffix if it must ship to the client.`,
        );
      }
    }
  }

  /**
   * Once-per-package heavy-barrel detection over a finished build's metafile. A live server warns per offender as it's
   * seen; under `bufferBarrelWarnings` they accumulate into one grouped summary from `flushBarrelWarnings()`.
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

  /** Output names reachable from `roots` by following static imports, roots included. */
  private static reachableOutputNames(roots: string[], outputByName: Map<string, { imports: string[] }>): Set<string> {
    const visited = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (visited.has(name)) {
        continue;
      }
      visited.add(name);
      const dep = outputByName.get(name);
      if (dep) {
        queue.push(...dep.imports);
      }
    }
    return visited;
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
    for (const name of ComponentRegistry.reachableOutputNames(entry.imports, outputByName)) {
      const dep = outputByName.get(name);
      if (dep) {
        addInputs(dep.inputs);
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

  getFontAsset(urlPath: string): { diskPath: string; contentType: string } | undefined {
    return this.fontAssets.get(urlPath) ?? this.devStaleFontAssets.get(urlPath);
  }

  /** A non-font asset Bun wrote beside a bundled stylesheet, served from where that stylesheet's relative `url()` lands. */
  getImportedCssAsset(urlPath: string): { diskPath: string; contentType: string } | undefined {
    return this.importCssAssets.get(urlPath);
  }

  getFontAssets(): Map<string, { diskPath: string; contentType: string }> {
    return this.fontAssets;
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
    // Only the per-registry map is cleared; `localAssetRegistry` on globalThis stays append-only so already-rendered dev
    // HTML can still resolve a replaced image's old hashed URL, and the manifest builds from this map, keeping stale
    // globals out of prod.
    this.localImageAssets.clear();
    this.retireFontAssets();
    this.importedCssFontPreloads.clear();
  }

  /** Dev-only: bridges the async gap during a re-bundle by keeping old hashed font URLs resolvable via `devStaleFontAssets` while the manifest reads only the live map. */
  private retireFontAssets(): void {
    if (this.development) {
      for (const [url, asset] of this.fontAssets) {
        this.devStaleFontAssets.set(url, asset);
      }
    }
    this.fontAssets.clear();
  }

  /**
   * Bundle a set of side-effect CSS import paths in parallel, pushing a `css-bundle-failed` entry into `this.errors` on
   * failure so the dev overlay surfaces it. Hashed naming keeps entrypoints sharing a filename — every fontsource package
   * ships `index.css` — from colliding.
   */
  private bundleImportedCss(cssPaths: Iterable<string>): Promise<void> {
    return this.serializeCssBundling(() => this.bundleImportedCssBatch(cssPaths));
  }

  /**
   * Queue CSS-bundling work behind whatever is already running, since two entrypoints importing the same font emit the
   * same content-hashed bundler copy — one batch's end-of-run sweep would otherwise delete a file another batch is still
   * reading, and a re-bundle's reset would land mid-batch.
   */
  private serializeCssBundling<T>(task: () => Promise<T>): Promise<T> {
    const queued = this.importedCssBatches.catch(() => {}).then(task);
    this.importedCssBatches = queued;
    return queued;
  }

  /**
   * Drop the per-build suffix from the assets one bundle emitted, returning their canonical paths. Bun content-hashes
   * asset names, so a copy another build already renamed holds these exact bytes and this one's is redundant — dropping
   * it keeps the served name deterministic across builds, which a suffix left in place would not be.
   *
   * The canonical path only ever appears as the result of renaming a file Bun had finished writing, so a concurrent
   * reader sees it whole or not at all.
   */
  private reconcileEmittedAssets(emitted: string[], token: string): string[] {
    return emitted.map((assetPath) => {
      const canonical = assetPath.replace(`-${token}`, '');
      try {
        // `renameSync` onto an existing path throws on Windows rather than replacing, which is the same answer as
        // finding it already there: another build won, and its copy is byte-identical.
        if (fs.existsSync(canonical)) {
          fs.rmSync(assetPath, { force: true });
        } else {
          fs.renameSync(assetPath, canonical);
        }
      } catch {
        fs.rmSync(assetPath, { force: true });
      }
      return canonical;
    });
  }

  private async bundleImportedCssBatch(cssPaths: Iterable<string>): Promise<void> {
    const importCssOutDir = path.resolve(`${this.outDir}/import-css`);
    const todo = [...cssPaths].filter((p) => !this.importedCssUrls.has(p));
    if (todo.length === 0) {
      return;
    }

    // Cleared only once every entrypoint has read what it needs, since parallel bundles share a content-hashed copy.
    const deadArtifacts = new Set<string>();
    // The same copy can be adopted by one stylesheet and left in place by another, whose url() still names it.
    const liveArtifacts = new Set<string>();
    await Promise.all(
      todo.map(async (cssPath) => {
        // Bun's CSS bundler resolves every url() itself and runs plugin hooks for them, so font discovery rides the
        // bundler: large fonts become tiny marker data: URIs (see createFontMarkerPlugin) substituted below.
        const { plugin: fontPlugin, refs: fontRefs } = createFontMarkerPlugin(this.fontInlineThreshold);
        // Entrypoints bundle in parallel and two importing the same font emit the same content-hashed copy, so without
        // a per-build suffix they are concurrent writers to one path and a reader can catch it half-written. Stripped
        // again by reconcileEmittedAssets below, which puts the canonical name back.
        const token = randomUUID().slice(0, 8);
        const cssResult = await Bun.build({
          entrypoints: [cssPath],
          outdir: importCssOutDir,
          naming: { entry: '[name]-[hash].[ext]', asset: `[name]-[hash]-${token}.[ext]` },
          minify: true,
          plugins: Number.isFinite(this.fontInlineThreshold) ? [fontPlugin] : [],
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
        // Read from disk: when Bun.build writes via `outdir`, the output's
        // .text() may return empty — the file on disk is the source of truth.
        const rawCss = await Bun.file(out.path).text();
        const suffixed = cssResult.outputs.filter((o) => o !== out).map((o) => o.path);
        const emitted = this.reconcileEmittedAssets(suffixed, token);
        let cssText = rawCss;
        // Exact filenames rather than the bare suffix, which could collide with an unrelated run of the same characters.
        suffixed.forEach((original, i) => {
          cssText = cssText.replaceAll(path.basename(original), path.basename(emitted[i]!));
        });
        const adopted = await adoptEmittedFontAssets(
          cssText,
          emitted.map((path) => ({ path })),
          fontRefs,
        );
        cssText = adopted.css;
        for (const assetPath of adopted.adopted) {
          deadArtifacts.add(assetPath);
        }
        for (const assetPath of adopted.missing) {
          const message = `the bundler's copy of ${relForDisplay(assetPath)} vanished before it could be read, so its @font-face still points at a file no route serves. Please report this.`;
          logger.error(`CSS bundle for ${cssPath}: ${message}`);
          this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
        }
        // Bun printed these relative to the stylesheet, so serving them under its `import-css/` prefix is what makes
        // the URL it already wrote resolve.
        for (const assetPath of adopted.otherAssets) {
          liveArtifacts.add(assetPath);
          const name = path.basename(assetPath);
          const file = Bun.file(assetPath);
          this.importCssAssets.set(`${this.assetPrefix}/import-css/${name}`, { diskPath: assetPath, contentType: file.type });
          // Deduped against the stats rather than the map, which a dev re-bundle rebuilds while leaving entries in place.
          const statName = path.posix.join('import-css', name);
          if (!this.importedCssStats.some((s) => s.name === statName)) {
            this.importedCssStats.push({ name: statName, size: file.size, inputs: [], imports: [] });
          }
        }
        const fontPass = classifyFontAssets(cssText, fontRefs, { dropLegacyWoff: this.fontDropLegacyWoff });
        cssText = fontPass.css;
        if (fontPass.parseFailed) {
          const message = 'the bundled stylesheet could not be parsed, so any extracted font is still a marker where its bytes should be. Please report this.';
          logger.error(`CSS bundle for ${cssPath}: ${message}`);
          this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
        }
        const preloadUrls: string[] = [];
        const fontUrlByMarker = new Map<string, string>();
        for (const font of fontPass.fonts) {
          const bytes = font.ref.bytes ?? (await Bun.file(font.ref.path).bytes());
          if (fontChangedSinceResolved(font.ref, bytes)) {
            const message = `the source font ${relForDisplay(font.ref.path)} was ${font.ref.size} bytes when the bundle resolved it but read back ${bytes.length}, so it changed mid-build. If this persists the file is corrupt.`;
            logger.error(`CSS bundle for ${cssPath}: ${message}`);
            this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
          }
          const fileName = fontAssetFileName(font.ref, bytes);
          const diskPath = path.join(this.outDir, 'fonts', fileName);
          const fontUrl = `${this.assetPrefix}/fonts/${fileName}`;
          fontUrlByMarker.set(font.markerUri, fontUrl);
          if (font.preload) {
            preloadUrls.push(fontUrl);
          }
          // Registering before the first await keeps the check-then-set atomic across the concurrently bundling
          // entrypoints, so a font shared between stylesheets is written and counted in the stats exactly once.
          if (!this.fontAssets.has(fontUrl)) {
            this.fontAssets.set(fontUrl, { diskPath, contentType: font.contentType });
            this.importedCssStats.push({
              name: path.posix.join('fonts', fileName),
              size: bytes.length,
              inputs: [{ path: relForDisplay(font.ref.path), size: bytes.length }],
              imports: [],
            });
            // The content-hashed name means an existing file already holds these exact bytes; skipping the rewrite
            // keeps a dev-rebundle from truncating a file a concurrent request may be reading.
            if (!(await Bun.file(diskPath).exists())) {
              await Bun.write(diskPath, bytes);
            }
          }
        }
        cssText = substituteFontUrls(cssText, fontUrlByMarker);
        for (const font of fontPass.fonts) {
          if (cssText.includes(font.ref.markerB64)) {
            const message = `extracted font ${relForDisplay(font.ref.path)} kept its marker after URL substitution — the bundler printed a url() form the substitution missed. Please report this.`;
            logger.error(`CSS bundle for ${cssPath}: ${message}`);
            this.errors.push({ kind: 'css-bundle-failed', cssPath, message });
          }
        }
        let outPath = out.path;
        if (cssText !== rawCss) {
          // Bun hashed the pre-substitution text, so the served bytes (font URLs carrying font-content hashes,
          // `dropLegacyWoff` pruning) must re-hash into the immutable filename or a redeploy reuses a stale cached copy.
          outPath = path.join(importCssOutDir, `${path.basename(out.path, '.css')}-${fontContentHash(Buffer.from(cssText))}.css`);
          await Bun.write(outPath, cssText);
          fs.rmSync(out.path, { force: true });
        }
        const urlPath = `${this.assetPrefix}/import-css/${path.basename(outPath)}`;
        if (preloadUrls.length > 0) {
          this.importedCssFontPreloads.set(cssPath, preloadUrls);
        }
        this.clientFiles.set(urlPath, cssText);
        this.importedCssUrls.set(cssPath, urlPath);
        this.importedCssStats.push({
          name: path.basename(outPath),
          size: cssText.length,
          inputs: [{ path: relForDisplay(cssPath), size: cssText.length }],
          imports: [],
        });
      }),
    );
    for (const artifact of deadArtifacts) {
      if (!liveArtifacts.has(artifact)) {
        fs.rmSync(artifact, { force: true });
      }
    }
  }

  /** Re-bundles every previously seen side-effect CSS import for the dev watcher's CSS-only fast-path, leaving page modules and entry tracking alone. */
  rebundleImportedCss(): Promise<void> {
    // Reset inside the queue, or an in-flight batch repopulates what was just cleared and the re-bundle then skips those
    // paths as already-bundled, serving pre-edit CSS.
    return this.serializeCssBundling(async () => {
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
      this.retireFontAssets();
      this.importedCssFontPreloads.clear();
      await this.bundleImportedCssBatch(cssPaths);
    });
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
   * Targeted rebuild driven by a single file change: walks `entryDeps` for every page whose dep graph contains
   * `changedPath`, force-recompiles them with client-bundle deferral, then runs one trailing `buildClientBundle()`.
   *
   * The old `compiledComponents` entry stays until `compile()` swaps it via the trailing `set()`, so concurrent
   * `renderComponent` calls keep serving the previous module and never trigger a parallel `Bun.build` racing on the SSR
   * output file.
   *
   * An empty `pages` set means the path is in no dep graph and is no registered entry, letting the caller skip the client
   * reload for edits outside the page graph (server entry, package.json), which need a process restart anyway. Paths in
   * `pages` are absolute, matching the `window.__mochi_page_entry` value injected into SSR'd HTML.
   */
  async recompileChanged(changedPath: string): Promise<{ pages: Set<string>; clientBundleCount: number }> {
    const changed = path.resolve(changedPath);
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
    // `compileAll` already calls `buildClientBundle` once when the cohort contributes hydratables, so a trailing call is
    // forced only where this recompile removed the cohort's hydratables while other cached pages still have some, leaving
    // stale entries for the bundle to drop.
    if (this.hydratableComponents.length > 0 && this.clientBundleCallCount === 0) {
      await this.buildClientBundle();
    }
    return { pages: new Set(affected), clientBundleCount: this.clientBundleCallCount };
  }

  /**
   * Clear the cache and eagerly re-compile every previously compiled page, so the dev watcher's live-reload signal fires
   * only once client JS chunks exist and browsers stop racing the build into 404s on chunk requests.
   *
   * The client bundle defers to a single trailing call; without the flag each page's tail `buildClientBundle()` rebuilds
   * the same monolithic bundle, O(N²) work for one save. The returned summary feeds the `recompile:complete` event, with
   * absolute paths in `pages` matching the `recompileChanged` contract.
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
    return { pages: new Set(pageFiles), clientBundleCount: this.clientBundleCallCount };
  }

  /** Serialize registry state into a manifest for the prebuild step. */
  toManifest(): MochiManifest {
    const outDirAbs = path.resolve(this.outDir);
    // Every artifact the runtime reads lives under outDir, so outDir-relative paths keep the build output relocatable.
    // This guard fires only if some artifact kind added later stops deriving from outDir, which would bake an absolute
    // path read back verbatim at boot and pin the build to one machine. The `isAbsolute` check covers Windows, where a
    // different-drive target makes `path.relative()` return an absolute path with no leading `..`.
    const relToOutDir = (p: string): string => {
      const abs = path.resolve(p);
      const rel = path.relative(outDirAbs, abs);
      const escapes = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
      if (escapes) {
        logger.warn(
          `Build artifact ${relForDisplay(abs)} lives outside the out-dir — baking an absolute path. ` +
            `This build will not relocate: it only boots from this exact filesystem path.`,
        );
        return toPosixPath(abs);
      }
      return toPosixPath(rel);
    };

    // Source paths are lookup keys, never read from disk, but they still get
    // project-root-relative treatment so a manifest carries nothing specific to
    // the machine that built it. See `manifestPaths.ts`.
    const components: MochiManifest['components'] = {};
    for (const [filename, entry] of this.compiledComponents) {
      components[encodeSourcePath(filename)] = {
        ssrModule: relToOutDir(entry.ssrPath),
        hydratables: entry.hydratables.map((h) => ({
          name: h.name,
          displayName: h.displayName,
          resolvedPath: encodeSourcePath(h.resolvedPath),
          exportName: h.exportName,
        })),
        cssComponents: [...entry.cssComponents].map((p) => encodeSourcePath(p)),
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
      cssFileUrls: Object.fromEntries([...this.cssFileUrls].map(([componentPath, url]) => [encodeSourcePath(componentPath), url])),
      clientFiles,
      components,
      stats: this.getClientStats(),
      serverIslandPaths: Object.fromEntries([...this.serverIslandPaths].map(([name, resolvedPath]) => [name, encodeSourcePath(resolvedPath)])),
    };
    if (this.serverIslandExports.size > 0) {
      manifest.serverIslandExports = Object.fromEntries(this.serverIslandExports);
    }
    if (this.localImageAssets.size > 0) {
      manifest.localImageAssets = Object.fromEntries([...this.localImageAssets].map(([url, asset]) => [url, { ...asset, diskPath: relToOutDir(asset.diskPath) }]));
    }
    if (this.importedCssUrls.size > 0) {
      manifest.importedCssUrls = Object.fromEntries([...this.importedCssUrls].map(([cssPath, url]) => [encodeSourcePath(cssPath), url]));
    }
    if (this.fontAssets.size > 0) {
      manifest.fontAssets = Object.fromEntries([...this.fontAssets].map(([url, asset]) => [url, { ...asset, diskPath: relToOutDir(asset.diskPath) }]));
    }
    if (this.importCssAssets.size > 0) {
      manifest.importCssAssets = Object.fromEntries([...this.importCssAssets].map(([url, asset]) => [url, { ...asset, diskPath: relToOutDir(asset.diskPath) }]));
    }
    if (this.importedCssFontPreloads.size > 0) {
      manifest.importedCssFontPreloads = Object.fromEntries([...this.importedCssFontPreloads].map(([cssPath, urls]) => [encodeSourcePath(cssPath), urls]));
    }
    if (this.entryImportedCss.size > 0) {
      manifest.entryImportedCss = Object.fromEntries([...this.entryImportedCss].map(([k, v]) => [encodeSourcePath(k), [...v].map((p) => encodeSourcePath(p))]));
    }
    if (this.serverIslandScriptFile) {
      manifest.serverIslandScript = relToOutDir(this.serverIslandScriptFile);
    }
    return manifest;
  }

  /** Load a registry from a prebuilt manifest (production mode). `options` carries serve-time config a manifest can't: on-demand compiles (manifest misses) must honor it or they diverge from the build output. */
  static async fromManifest(manifestPath: string, development: boolean = false, options: Pick<ComponentRegistryOptions, 'fonts'> = {}): Promise<ComponentRegistry> {
    const raw = await Bun.file(manifestPath).text();
    const manifest: MochiManifest = JSON.parse(raw);

    // The manifest layout is not forwards- or backwards-compatible: a mismatch
    // means the artifacts on disk are laid out for different loader rules, which
    // fails as a confusing "file not found" deep in the boot instead of here.
    if (manifest.version !== MANIFEST_VERSION) {
      throw new Error(
        `[mochi] Manifest at ${relForDisplay(manifestPath)} is version ${manifest.version}, but this mochi-framework runtime reads version ${MANIFEST_VERSION}. ` +
          `Build and serve with the same mochi-framework version, then re-run \`mochi-framework build\`.`,
      );
    }

    // build() always writes manifest.json at the out-dir root, so the manifest's
    // own directory *is* the build out-dir. Deriving the artifact root from the
    // manifest's own location makes the pairing intrinsic — there's no caller-
    // supplied out-dir that could desync from where the artifacts actually live.
    const artifactRoot = path.dirname(path.resolve(manifestPath));
    // Absolute entries are the escape hatch for artifacts that landed outside
    // the out-dir (toManifest() warns when it bakes one) — pass them through.
    const resolveManifestPath = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(artifactRoot, p));

    const registry = new ComponentRegistry({
      development,
      outDir: artifactRoot,
      assetPrefix: manifest.assetPrefix,
      fonts: options.fonts,
    });
    registry.loadedFromManifest = true;
    registry.publicFileCountAtBuild = manifest.publicFileCount ?? 0;

    registry.islandBootstrapUrl = manifest.bootstrapUrl;
    registry.clientStats = manifest.stats;

    for (const [name, url] of Object.entries(manifest.componentEntryUrls)) {
      registry.componentEntryUrls.set(name, url);
    }

    // Source keys go back to absolute. An on-demand compile (a manifest miss, or
    // a dev rebuild) always writes absolute keys, so decoding here is what lets
    // manifest-restored and freshly-compiled entries share one set of maps.
    for (const [componentPath, cssUrl] of Object.entries(manifest.cssFileUrls)) {
      registry.cssFileUrls.set(decodeSourcePath(componentPath), cssUrl);
    }

    // Load all client files (JS + CSS) from disk into memory
    for (const [urlPath, diskPath] of Object.entries(manifest.clientFiles)) {
      const content = await Bun.file(resolveManifestPath(diskPath)).text();
      registry.clientFiles.set(urlPath, content);
    }

    // Restore side-effect CSS import mappings
    if (manifest.importedCssUrls) {
      for (const [cssPath, url] of Object.entries(manifest.importedCssUrls)) {
        registry.importedCssUrls.set(decodeSourcePath(cssPath), url);
      }
    }
    if (manifest.fontAssets) {
      for (const [url, asset] of Object.entries(manifest.fontAssets)) {
        registry.fontAssets.set(url, { ...asset, diskPath: resolveManifestPath(asset.diskPath) });
      }
    }
    if (manifest.importCssAssets) {
      for (const [url, asset] of Object.entries(manifest.importCssAssets)) {
        registry.importCssAssets.set(url, { ...asset, diskPath: resolveManifestPath(asset.diskPath) });
      }
    }
    if (manifest.importedCssFontPreloads) {
      for (const [cssPath, urls] of Object.entries(manifest.importedCssFontPreloads)) {
        registry.importedCssFontPreloads.set(decodeSourcePath(cssPath), urls);
      }
    }
    if (manifest.entryImportedCss) {
      for (const [entryPath, cssPaths] of Object.entries(manifest.entryImportedCss)) {
        registry.entryImportedCss.set(decodeSourcePath(entryPath), new Set(cssPaths.map((p) => decodeSourcePath(p))));
      }
    }

    // Load SSR modules and populate compiledComponents
    for (const [filename, entry] of Object.entries(manifest.components)) {
      const modulePath = resolveManifestPath(entry.ssrModule);
      const mod = await import(Bun.pathToFileURL(modulePath).href);
      // Manifests written before exportName existed omit it — those islands are
      // all default imports, so normalize before anything indexes on it.
      const hydratables = entry.hydratables.map((h) => ({ ...h, exportName: h.exportName ?? 'default', resolvedPath: decodeSourcePath(h.resolvedPath) }));
      registry.compiledComponents.set(decodeSourcePath(filename), {
        module: mod,
        cssComponents: new Set(entry.cssComponents.map((p) => decodeSourcePath(p))),
        hydratables,
        ...indexHydratables(hydratables),
        ssrPath: modulePath,
      });
      registry.hydratableComponents.push(...hydratables);
    }

    // Load server island paths from manifest
    if (manifest.serverIslandPaths) {
      for (const [name, resolvedPath] of Object.entries(manifest.serverIslandPaths)) {
        registry.serverIslandPaths.set(name, decodeSourcePath(resolvedPath));
      }
    }
    if (manifest.serverIslandExports) {
      for (const [name, exportName] of Object.entries(manifest.serverIslandExports)) {
        registry.serverIslandExports.set(name, exportName);
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
