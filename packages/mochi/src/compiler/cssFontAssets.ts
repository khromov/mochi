import fs from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';

/**
 * A font file Bun's bundler resolved behind a `url()` in a CSS build, replaced with marker bytes by
 * {@link createFontMarkerPlugin} so the bundled output carries a tiny, exactly-predictable `data:` URI instead of the
 * base64-encoded font.
 */
export interface FontRef {
  path: string;
  size: number;
  markerB64: string;
}

/** A font that survived classification and should be emitted as a separate served asset. */
export interface SurvivingFont {
  ref: FontRef;
  /** MIME Bun stamped on the marker `data:` URI; reused as the served Content-Type. */
  contentType: string;
  /** The exact `data:` URI occupying the ref's url() tokens, the substitution target for the final URL. */
  markerUri: string;
  /** Worth a `<link rel="preload">`: a woff2 whose face is unranged or latin-visible. */
  preload: boolean;
}

export const FONT_URL_FILTER = /\.(woff2?|ttf|otf|eot)$/;

export function fontContentHash(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex').slice(0, 8);
}

/**
 * Bun's CSS bundler base64-inlines every `url()` unconditionally and ignores `loader: 'file'`, but does run plugin
 * hooks for resolved references — fonts above the threshold get their bytes swapped for a unique marker at `onLoad`,
 * keeping the bundler in charge of discovery while the bundled CSS stays tiny.
 */
export function createFontMarkerPlugin(inlineThreshold: number): { plugin: BunPlugin; refs: FontRef[] } {
  const refs: FontRef[] = [];
  const plugin: BunPlugin = {
    name: 'mochi-font-markers',
    setup(build) {
      build.onLoad({ filter: FONT_URL_FILTER }, (args) => {
        const size = fs.statSync(args.path).size;
        if (size <= inlineThreshold) {
          return undefined;
        }
        const marker = `__MOCHI_FONT_${refs.length}__`;
        refs.push({ path: args.path, size, markerB64: Buffer.from(marker).toString('base64') });
        return { contents: marker, loader: 'file' };
      });
    },
  };
  return { plugin, refs };
}

const URL_TOKEN_RE = /url\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^'")][^)]*)\s*\)/g;
const FONT_FACE_RE = /@font-face\s*\{[^{}]*\}/g;
const DATA_URI_RE = /^data:([^;,]+);base64,(.*)$/s;

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Overlap with U+0000–00FF, the glyphs first paint always needs; a face visible there is worth preloading. */
function unicodeRangeTouchesLatin(rangeValue: string): boolean {
  for (const token of rangeValue.split(',')) {
    const m = token.trim().match(/^U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
    if (!m) {
      continue;
    }
    const lo = parseInt(m[1]!.replaceAll('?', '0'), 16);
    const hi = m[2] !== undefined ? parseInt(m[2], 16) : parseInt(m[1]!.replaceAll('?', 'f'), 16);
    if (lo <= 0xff && hi >= 0) {
      return true;
    }
  }
  return false;
}

// Splitting a `src:` list on every comma would sever multi-argument functions like `tech(features-aat, color-COLRv1)`,
// leaving an orphaned tail that invalidates the whole descriptor when its source is dropped.
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

interface ParsedSource {
  /** Original source text with `url(...)` still tokenized as `@@n@@`. */
  text: string;
  urlIndex: number | null;
  format: string | null;
}

function classifyFormat(source: ParsedSource, urlValue: string | undefined, refForUrl: FontRef | undefined): string | null {
  if (source.format) {
    return source.format.toLowerCase();
  }
  const pathLike = refForUrl?.path ?? urlValue;
  if (!pathLike) {
    return null;
  }
  const dataMime = pathLike.match(/^data:([^;,]+)/)?.[1];
  if (dataMime) {
    return dataMime.toLowerCase().split('/').pop() ?? null;
  }
  return pathLike.split('?')[0]!.split('.').pop()?.toLowerCase() ?? null;
}

/**
 * Classify the marker `data:` URIs a {@link createFontMarkerPlugin} build left in the bundled CSS: prune legacy woff
 * sources, decide preload-worthiness per `@font-face` block, and report every ref still referenced so the caller can
 * emit those files and substitute their `markerUri` with the final served URL.
 */
export function classifyFontAssets(css: string, refs: FontRef[], opts: { dropLegacyWoff: boolean }): { css: string; fonts: SurvivingFont[] } {
  // No zero-refs early return: legacy-woff pruning must still run when every font inlined for real (all under the
  // threshold, or the marker plugin skipped entirely via `inlineThreshold: Infinity`).
  const refByMarker = new Map(refs.map((ref) => [ref.markerB64, ref]));
  // The bundler decides the marker URI's exact text (MIME from the file extension), so capture it from the CSS rather
  // than re-deriving it.
  const found = new Map<FontRef, { contentType: string; markerUri: string; preload: boolean }>();
  for (const m of css.matchAll(/data:([^;,]+);base64,([A-Za-z0-9+/=]+)/g)) {
    const ref = refByMarker.get(m[2]!);
    if (ref && !found.has(ref)) {
      found.set(ref, { contentType: m[1]!.toLowerCase(), markerUri: m[0], preload: false });
    }
  }

  const outCss = css.replace(FONT_FACE_RE, (block) => {
    // Tokenize url() payloads first: data URIs contain `;` and `,`, so no declaration-level parsing is safe before this.
    const urls: string[] = [];
    const safeBlock = block.replace(URL_TOKEN_RE, (_m, value: string) => {
      urls.push(unquote(value));
      return `url(@@${urls.length - 1}@@)`;
    });

    const rangeValue = safeBlock.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1];
    const latinVisible = rangeValue === undefined || unicodeRangeTouchesLatin(rangeValue);

    const refForUrl = (value: string | undefined): FontRef | undefined => {
      const payload = value?.match(DATA_URI_RE)?.[2];
      return payload !== undefined ? refByMarker.get(payload) : undefined;
    };

    const rewritten = safeBlock.replace(/(src\s*:\s*)([^;}]+)/gi, (_m, prefix: string, value: string) => {
      const sources: ParsedSource[] = splitTopLevel(value).map((text) => {
        const urlIndex = text.match(/url\(@@(\d+)@@\)/)?.[1];
        return {
          text: text.trim(),
          urlIndex: urlIndex !== undefined ? Number(urlIndex) : null,
          format: text.match(/format\(\s*["']?([\w-]+)["']?\s*\)/i)?.[1] ?? null,
        };
      });

      const formats = sources.map((s) => {
        const urlValue = s.urlIndex !== null ? urls[s.urlIndex] : undefined;
        return classifyFormat(s, urlValue, refForUrl(urlValue));
      });
      // Only a woff2 this pipeline itself emits or inlines (a `data:` URI at this stage) justifies pruning the woff
      // fallback — an external woff2 (CDN url the bundler left alone) can be unreachable offline or blocked by CSP.
      const hasWoff2 = sources.some((s, i) => {
        if (formats[i] !== 'woff2' && formats[i] !== 'woff2-variations') {
          return false;
        }
        const urlValue = s.urlIndex !== null ? urls[s.urlIndex] : undefined;
        return urlValue?.startsWith('data:') ?? false;
      });

      const kept: string[] = [];
      sources.forEach((source, i) => {
        // Legacy woff goes whether inlined or marked — a data: URI copy is payload all the same.
        if (opts.dropLegacyWoff && hasWoff2 && formats[i] === 'woff' && source.urlIndex !== null) {
          return;
        }
        const ref = refForUrl(source.urlIndex !== null ? urls[source.urlIndex] : undefined);
        // Keyed off the file extension, not the format() hint, so `woff2-variations` variable fonts preload too.
        if (ref && ref.path.endsWith('.woff2') && latinVisible) {
          const entry = found.get(ref);
          if (entry) {
            entry.preload = true;
          }
        }
        kept.push(source.text);
      });

      return prefix + kept.join(', ');
    });

    return rewritten.replace(/url\(@@(\d+)@@\)/g, (_m, i: string) => {
      const value = urls[Number(i)]!;
      return /[\s'"(),]/.test(value) ? `url("${value.replaceAll('"', '\\"')}")` : `url(${value})`;
    });
  });

  // A ref whose sources were all pruned no longer occurs; a ref referenced outside any @font-face block still does.
  const fonts: SurvivingFont[] = [];
  for (const [ref, entry] of found) {
    if (outCss.includes(entry.markerUri)) {
      fonts.push({ ref, ...entry });
    }
  }
  return { css: outCss, fonts };
}

/**
 * Swap every `url()` holding the marker URI for the served URL; outside `@font-face` blocks (which
 * {@link classifyFontAssets} re-quotes) the quoting is whatever Bun's printer chose, so this tolerates all three forms.
 */
export function substituteFontUrl(css: string, markerUri: string, fontUrl: string): string {
  const escaped = markerUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.replace(new RegExp(String.raw`url\(\s*(["']?)${escaped}\1\s*\)`, 'g'), `url(${fontUrl})`);
}

export function fontAssetFileName(ref: FontRef, bytes: Uint8Array): string {
  const ext = path.extname(ref.path);
  const base = path.basename(ref.path, ext).replace(/[^\w-]/g, '-');
  return `${base}-${fontContentHash(bytes)}${ext}`;
}
