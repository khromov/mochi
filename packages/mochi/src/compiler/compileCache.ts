import type { HydratableComponent, PreprocessIslandError, ServerIslandComponent } from './svelteAstPreprocess';

/**
 * The full result of compiling one `.svelte` / `.md` source for a given target:
 * the emitted JS the bundler consumes, the scoped CSS (server only — the client
 * build strips CSS), and the hydration metadata extracted by the preprocessor.
 * Everything a call site needs to replay its side effects on a cache hit —
 * including the preprocessor's island errors, so a hit on an unfixed file
 * re-reports them instead of silently clearing the compile error.
 */
export interface CompiledFileOutput {
  js: string;
  css: string | null;
  hydratables: HydratableComponent[];
  serverIslands: ServerIslandComponent[];
  preprocessErrors: PreprocessIslandError[];
  /**
   * Decline reason from the hydration-context seed pass (null when seeded).
   * Cached so a hit still lets `compileAll` re-warn about an island root whose
   * subtree can't see `isHydratable()` — same replay rationale as
   * `preprocessErrors`.
   */
  seedDeclined: string | null;
}

interface CacheEntry {
  /** Raw source the output was derived from — `===` compared, so any byte change misses. */
  source: string;
  /** Compiler-options + dev-flag fingerprint, so a config reload misses too. */
  fingerprint: string;
  output: CompiledFileOutput;
}

export interface CompileCacheStats {
  hits: number;
  misses: number;
}

export function createCompileCacheStats(): CompileCacheStats {
  return { hits: 0, misses: 0 };
}

/**
 * Compute the cache fingerprint for a build. Output depends on the merged Svelte
 * compiler options and the dev flag; `target` is already encoded in the key.
 * Functions in the options (e.g. `warningFilter`) are dropped by JSON — they
 * don't affect emitted code, so a collision on them is harmless.
 *
 * The fingerprint deliberately does NOT cover the markdown/mdsvex config or the
 * user preprocessors: those aren't serializable (functions/plugins), and they're
 * fixed for the lifetime of a `CompileCache` instance — which is owned by a
 * single `ComponentRegistry`. Two registries with different markdown/preprocessor
 * config never share a cache, so they can't collide. See {@link CompileCache}.
 */
export function compileFingerprint(userCompilerOptions: unknown, development: boolean): string {
  return `${JSON.stringify(userCompilerOptions ?? {})}|dev=${development}`;
}

/**
 * Content-addressed cache of compiled component output, owned per
 * `ComponentRegistry` instance (NOT a module global). Per-instance scoping is
 * load-bearing for correctness: compiled output depends on the registry's
 * markdown/mdsvex config and user preprocessors, which the {@link compileFingerprint}
 * can't serialize. A module-global cache shared across registries could serve
 * registry B the output registry A produced for the same path under different
 * config — per-instance ownership makes that collision unrepresentable. (This is
 * why the compile cache is instance-scoped while `preprocessCache` can safely be
 * a module global: the directive scan it memoizes is config-independent.)
 */
export class CompileCache {
  // Keyed by `${target}\u0000${filePath}` so the server and client builds of the same
  // file get independent entries (different `generate` / `dev` compiler options).
  #entries: Map<string, CacheEntry> = new Map();

  #key(target: 'server' | 'client', filePath: string): string {
    return `${target}\u0000${filePath}`;
  }

  get(target: 'server' | 'client', filePath: string, source: string, fingerprint: string, stats?: CompileCacheStats): CompiledFileOutput | undefined {
    const entry = this.#entries.get(this.#key(target, filePath));
    if (entry && entry.source === source && entry.fingerprint === fingerprint) {
      if (stats) {
        stats.hits++;
      }
      return entry.output;
    }
    if (stats) {
      stats.misses++;
    }
    return undefined;
  }

  set(target: 'server' | 'client', filePath: string, source: string, fingerprint: string, output: CompiledFileOutput): void {
    this.#entries.set(this.#key(target, filePath), { source, fingerprint, output });
  }

  /**
   * Drop both target entries for `filePath`. Called by the dev watcher on `unlink`
   * so deleted files don't accumulate stale entries over a long dev session.
   */
  evict(filePath: string): void {
    this.#entries.delete(this.#key('server', filePath));
    this.#entries.delete(this.#key('client', filePath));
  }

  /** Drop everything — used on `svelte.config` reload, when every entry's config basis may have changed. */
  reset(): void {
    this.#entries.clear();
  }
}
