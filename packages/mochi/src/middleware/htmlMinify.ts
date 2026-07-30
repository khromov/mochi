import type { Handle } from '../runtime/hooks';
import { getMochiConfig } from '../mochiConfig';

export interface HtmlMinifyOptions {
  /** Minify inline CSS in `<style>` tags and `style` attributes (lightningcss). Default `false`. */
  minifyCss?: boolean;
  /** Minify inline JavaScript in `<script>` tags (oxc). Default `false` — risky around framework hydration scripts. */
  minifyJs?: boolean;
  /** Run in development too. Default `false` — like `compress()`, minification is skipped in dev. */
  dev?: boolean;
}

interface MinifyConfig {
  minifyCss: boolean;
  minifyJs: boolean;
}

function isDev(): boolean {
  try {
    return getMochiConfig().options.development ?? true;
  } catch {
    // Mochi.serve() hasn't initialized config (e.g. unit tests) — assume prod.
    return false;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// `@minify-html/wasm` is a wasm-bindgen *bundler*-target package: importing it directly throws in Bun because the
// `.wasm`'s glue is never wired up. We hand-instantiate it once (its only import module is `./index_bg.js`) and cache
// the promise, resetting on failure — mirrors `loadCssInline` in email/render.ts.
let minifyPromise: Promise<(code: Uint8Array, cfg: Record<string, boolean>) => Uint8Array> | undefined;

function loadMinify(): Promise<(code: Uint8Array, cfg: Record<string, boolean>) => Uint8Array> {
  if (!minifyPromise) {
    minifyPromise = (async () => {
      // `: string` widens the specifier so TS skips module resolution — the glue subpath ships no `.d.ts`.
      const gluePath: string = '@minify-html/wasm/index_bg.js';
      const glue = (await import(gluePath)) as {
        __wbg_set_wasm(exports: WebAssembly.Exports): void;
        minify(code: Uint8Array, cfg: Record<string, boolean>): Uint8Array;
      };
      const bytes = await Bun.file(new URL(import.meta.resolve('@minify-html/wasm/index_bg.wasm'))).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, { './index_bg.js': glue as unknown as WebAssembly.ModuleImports });
      glue.__wbg_set_wasm(instance.exports);
      return glue.minify;
    })().catch((err) => {
      minifyPromise = undefined;
      throw err;
    });
  }
  return minifyPromise;
}

// minify-html collapses whitespace across the whole document with no per-subtree opt-out, which corrupts the DOM that
// Svelte re-walks when hydrating an island (verified: `hydration_mismatch`). Only island *internals* hydrate, so we mask
// each outermost island subtree with a placeholder comment, minify everything else, then restore the island bytes
// verbatim. Nested islands ride along inside their outer parent's preserved region.
const ISLAND_TAGS = /<(\/?)(?:mochi-hydratable-island|mochi-server-island)(?:\s[^>]*?)?>/g;
const ISLAND_TOKEN = (n: number) => `<!--__mochi_island_${n}__-->`;

function maskIslands(html: string): { masked: string; islands: string[] } {
  const islands: string[] = [];
  let masked = '';
  let depth = 0;
  let regionStart = -1;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  ISLAND_TAGS.lastIndex = 0;
  while ((m = ISLAND_TAGS.exec(html)) !== null) {
    if (m[1] !== '/') {
      if (depth === 0) {
        regionStart = m.index;
        masked += html.slice(lastIndex, m.index);
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        masked += ISLAND_TOKEN(islands.length);
        islands.push(html.slice(regionStart, ISLAND_TAGS.lastIndex));
        lastIndex = ISLAND_TAGS.lastIndex;
      }
    }
  }
  masked += html.slice(lastIndex);
  return { masked, islands };
}

/**
 * Minify a full HTML document with `minify-html`, preserving hydration-island subtrees byte-for-byte. `keep_comments` is
 * forced on: dropping comments would delete Svelte hydration markers (`<!--[-->` …). Island internals are masked out
 * before minifying and restored after (see {@link maskIslands}); the non-island page body is never hydrated, so
 * collapsing it is safe.
 */
export async function minifyHtml(html: string, cfg: MinifyConfig): Promise<string> {
  const minify = await loadMinify();
  const { masked, islands } = maskIslands(html);
  let out = decoder.decode(minify(encoder.encode(masked), { keep_comments: true, minify_css: cfg.minifyCss, minify_js: cfg.minifyJs }));
  for (let i = 0; i < islands.length; i++) {
    // Function replacer so `$&`/`$1` sequences inside island HTML aren't interpreted.
    out = out.replace(ISLAND_TOKEN(i), () => islands[i]!);
  }
  return out;
}

/**
 * Composable middleware that minifies page HTML via `minify-html`. Place it early in `sequence(...)` (right after
 * `compress()`): merged `transformPage`s stack in reverse, so an early handle transforms last — after content-injecting
 * handles have added their markup and before `compress()` gzips the result. Skipped in development unless `opts.dev`.
 */
export function htmlMinify(opts: HtmlMinifyOptions = {}): Handle {
  const cfg: MinifyConfig = {
    minifyCss: opts.minifyCss ?? false,
    minifyJs: opts.minifyJs ?? false,
  };
  const runInDev = opts.dev ?? false;

  return async ({ event, resolve }) => {
    if (!runInDev && isDev()) {
      return resolve(event);
    }
    return resolve(event, {
      transformPage: async ({ html, done }) => (done ? await minifyHtml(html, cfg) : html),
    });
  };
}
