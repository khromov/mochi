import fs from 'node:fs';
import path from 'node:path';

/** A font binary decoded back out of a bundled stylesheet's `data:` URI. */
export interface ExtractedFontAsset {
  bytes: Uint8Array;
  contentType: string;
  /** Content-hashed basename, e.g. `inter-latin-400-normal-ab12cd34.woff2`. */
  fileName: string;
  /** Whether this asset is worth a `<link rel="preload">`: a woff2 whose face is unranged or latin-visible. */
  preload: boolean;
}

export interface FontExtractionOptions {
  /** Fonts at or below this byte size stay inlined. `Infinity` disables extraction. */
  inlineThreshold: number;
  /** Drop `format('woff')` sources from `src:` lists that also offer woff2. */
  dropLegacyWoff: boolean;
  /** Served URL for an extracted file name. */
  urlFor: (fileName: string) => string;
  /** Best-effort original basename (sans extension) for a decoded font, keyed by `fontContentHash`. */
  nameForHash?: (hash: string) => string | undefined;
}

export interface FontExtractionResult {
  css: string;
  assets: ExtractedFontAsset[];
}

const FONT_MIME_TO_EXT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'font/ttf': 'ttf',
  'application/x-font-ttf': 'ttf',
  'font/otf': 'otf',
  'application/x-font-opentype': 'otf',
  'font/sfnt': 'ttf',
  'application/vnd.ms-fontobject': 'eot',
};

export const FONT_FILE_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);

export function fontContentHash(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return hasher.digest('hex').slice(0, 8);
}

const URL_TOKEN_RE = /url\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^'")][^)]*)\s*\)/g;
const FONT_FACE_RE = /@font-face\s*\{[^{}]*\}/g;

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

interface ParsedSource {
  /** Original source text with `url(...)` still tokenized as `@@n@@`. */
  text: string;
  urlIndex: number | null;
  format: string | null;
}

function classifyFormat(source: ParsedSource, urlValue: string | undefined): string | null {
  if (source.format) {
    return source.format.toLowerCase();
  }
  if (!urlValue) {
    return null;
  }
  const dataMime = urlValue.match(/^data:([^;,]+)/)?.[1];
  const ext = dataMime ? FONT_MIME_TO_EXT[dataMime.toLowerCase()] : urlValue.split('?')[0]!.split('.').pop()?.toLowerCase();
  return ext ?? null;
}

/**
 * Rewrite bundled CSS so large fonts Bun inlined as `data:` URIs become separately-served binary assets, optionally
 * pruning legacy woff sources. Pure with respect to the filesystem — callers write the returned assets.
 */
export function extractFontAssets(css: string, opts: FontExtractionOptions): FontExtractionResult {
  const assetsByHash = new Map<string, ExtractedFontAsset>();

  const outCss = css.replace(FONT_FACE_RE, (block) => {
    // Tokenize url() payloads first: data URIs contain `;` and `,`, so no declaration-level parsing is safe before this.
    const urls: string[] = [];
    const safeBlock = block.replace(URL_TOKEN_RE, (_m, value: string) => {
      urls.push(unquote(value));
      return `url(@@${urls.length - 1}@@)`;
    });

    const rangeValue = safeBlock.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1];
    const latinVisible = rangeValue === undefined || unicodeRangeTouchesLatin(rangeValue);

    const rewritten = safeBlock.replace(/(src\s*:\s*)([^;}]+)/gi, (_m, prefix: string, value: string) => {
      const sources: ParsedSource[] = value.split(',').map((text) => {
        const urlIndex = text.match(/url\(@@(\d+)@@\)/)?.[1];
        return {
          text: text.trim(),
          urlIndex: urlIndex !== undefined ? Number(urlIndex) : null,
          format: text.match(/format\(\s*["']?([\w-]+)["']?\s*\)/i)?.[1] ?? null,
        };
      });

      const formats = sources.map((s) => classifyFormat(s, s.urlIndex !== null ? urls[s.urlIndex] : undefined));
      const hasWoff2 = formats.some((f) => f === 'woff2' || f === 'woff2-variations');

      const kept: string[] = [];
      sources.forEach((source, i) => {
        if (opts.dropLegacyWoff && hasWoff2 && formats[i] === 'woff' && source.urlIndex !== null) {
          return;
        }
        const urlValue = source.urlIndex !== null ? urls[source.urlIndex]! : undefined;
        const dataMatch = urlValue?.match(/^data:([^;,]+);base64,(.*)$/s);
        const ext = dataMatch ? FONT_MIME_TO_EXT[dataMatch[1]!.toLowerCase()] : undefined;
        if (!dataMatch || !ext) {
          kept.push(source.text);
          return;
        }
        const bytes = new Uint8Array(Buffer.from(dataMatch[2]!, 'base64'));
        if (bytes.length <= opts.inlineThreshold) {
          kept.push(source.text);
          return;
        }
        const hash = fontContentHash(bytes);
        let asset = assetsByHash.get(hash);
        if (!asset) {
          const name = (opts.nameForHash?.(hash) ?? 'font').replace(/[^\w-]/g, '-');
          asset = { bytes, contentType: dataMatch[1]!.toLowerCase(), fileName: `${name}-${hash}.${ext}`, preload: false };
          assetsByHash.set(hash, asset);
        }
        if (ext === 'woff2' && latinVisible) {
          asset.preload = true;
        }
        kept.push(source.text.replace(`url(@@${source.urlIndex}@@)`, `url(${opts.urlFor(asset.fileName)})`));
      });

      return prefix + kept.join(', ');
    });

    return rewritten.replace(/url\(@@(\d+)@@\)/g, (_m, i: string) => {
      const value = urls[Number(i)]!;
      return /[\s'"(),]/.test(value) ? `url("${value.replaceAll('"', '\\"')}")` : `url(${value})`;
    });
  });

  return { css: outCss, assets: [...assetsByHash.values()] };
}

/**
 * Best-effort map of font content hash → original basename (sans extension), built by walking a source stylesheet's
 * relative `url()` and `@import` references before bundling erases the file names into data URIs.
 */
export function scanFontSourceNames(entryCssPath: string, maxDepth = 8): Map<string, string> {
  const names = new Map<string, string>();
  const visited = new Set<string>();

  const walk = (cssPath: string, depth: number): void => {
    const resolved = path.resolve(cssPath);
    if (depth > maxDepth || visited.has(resolved) || !fs.existsSync(resolved)) {
      return;
    }
    visited.add(resolved);
    let css: string;
    try {
      css = fs.readFileSync(resolved, 'utf8');
    } catch {
      return;
    }
    const dir = path.dirname(resolved);
    for (const m of css.matchAll(URL_TOKEN_RE)) {
      const ref = unquote(m[1]!);
      if (ref.startsWith('data:') || /^[a-z][\w+.-]*:/i.test(ref) || ref.startsWith('#') || ref.startsWith('/')) {
        continue;
      }
      const refPath = path.resolve(dir, ref.split('?')[0]!.split('#')[0]!);
      if (!FONT_FILE_EXTENSIONS.has(path.extname(refPath).toLowerCase()) || !fs.existsSync(refPath)) {
        continue;
      }
      try {
        const bytes = new Uint8Array(fs.readFileSync(refPath));
        names.set(fontContentHash(bytes), path.basename(refPath, path.extname(refPath)));
      } catch {
        // Unreadable font file: bundling will surface it; the name map is cosmetic.
      }
    }
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?\s*\)?[^;]*;/g)) {
      const ref = m[1]!;
      if (ref.startsWith('.')) {
        walk(path.resolve(dir, ref), depth + 1);
      }
    }
  };

  walk(entryCssPath, 0);
  return names;
}
