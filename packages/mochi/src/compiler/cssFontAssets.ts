import fs from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';
import MagicString from 'magic-string';
import { parseCss, parseDataUri, removalSpans, type FontSource, type UrlRef } from './cssAst';

/**
 * A font file Bun's bundler resolved behind a `url()` in a CSS build, replaced with marker bytes by
 * {@link createFontMarkerPlugin} so the bundled output carries a tiny, exactly-predictable `data:` URI instead of the
 * base64-encoded font.
 */
export interface FontRef {
  path: string;
  size: number;
  markerB64: string;
  /** Set only by {@link adoptEmittedFontAssets}, whose `path` names a bundler copy awaiting deletion rather than a readable source. */
  bytes?: Uint8Array;
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

/** Bun's hardcoded `COPY_THRESHOLD`: a CSS `url()` asset this large is written beside the stylesheet, not inlined. */
export const BUN_CSS_COPY_THRESHOLD = 128 * 1024;

const FONT_MIME_BY_EXT: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
};

function markerFor(index: number): { marker: string; markerB64: string } {
  const marker = `__MOCHI_FONT_${index}__`;
  return { marker, markerB64: Buffer.from(marker).toString('base64') };
}

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
        // Declining a font Bun would copy rather than inline segfaults its bundler (verified on 1.3.14, exactly at
        // 128 kB), so those take the marker path whatever the threshold says.
        if (size <= inlineThreshold && size < BUN_CSS_COPY_THRESHOLD) {
          return undefined;
        }
        const { marker, markerB64 } = markerFor(refs.length);
        refs.push({ path: args.path, size, markerB64 });
        return { contents: marker, loader: 'file' };
      });
    },
  };
  return { plugin, refs };
}

/**
 * Fold fonts Bun wrote beside the stylesheet — anything {@link createFontMarkerPlugin} let through at or above
 * {@link BUN_CSS_COPY_THRESHOLD}, and every marked font once Bun honours `loader: 'file'` — back into marker `data:`
 * URIs, so {@link classifyFontAssets} sees one shape and nothing points at a file no route serves.
 *
 * `adopted` copies are dead but deleted by the caller, since entrypoints sharing a font emit the same content-hashed
 * path and removing it here would ENOENT a concurrent read; `otherAssets` keep the relative URL Bun printed. A copy the
 * bundler wrote and something else removed lands in `missing`, and one that never filled in lands in `unreadable` —
 * both let the caller report rather than ship a stylesheet pointing at a file no route serves.
 */
export async function adoptEmittedFontAssets(
  css: string,
  emitted: { path: string }[],
  refs: FontRef[],
): Promise<{ css: string; otherAssets: string[]; adopted: string[]; missing: string[]; unreadable: string[] }> {
  const otherAssets: string[] = [];
  const adopted: string[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];
  const refByMarker = new Map(refs.map((r) => [r.markerB64, r]));
  const urls = parseCss(css)?.urls ?? [];
  const edits = new MagicString(css);
  for (const artifact of emitted) {
    const ext = path.extname(artifact.path).toLowerCase();
    if (!FONT_URL_FILTER.test(artifact.path)) {
      otherAssets.push(artifact.path);
      continue;
    }
    const file = Bun.file(artifact.path);
    if (!(await file.exists())) {
      missing.push(artifact.path);
      continue;
    }
    const bytes = await readSettledBytes(artifact.path, file);
    // No font is zero bytes, so a copy still empty after the retries never becomes one: adopting it would content-hash
    // the empty string into the served filename and ship an @font-face pointing at nothing.
    if (bytes.length === 0) {
      unreadable.push(artifact.path);
      continue;
    }
    // A marked font: the file holds the marker text, not the font, so the real bytes come from the ref's source path.
    const marked = bytes.length < 64 ? refByMarker.get(Buffer.from(bytes).toString('base64')) : undefined;
    const markerB64 = marked?.markerB64 ?? markerFor(refs.length).markerB64;
    const mime = FONT_MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const references = urls.filter((url) => namesEmittedFile(url.value, path.basename(artifact.path)));
    if (references.length === 0) {
      // Bun printed a url() form this doesn't recognise, so the copy stays and serves the face unextracted — which
      // takes the real font, since a marked copy holds only marker text.
      if (marked) {
        fs.copyFileSync(marked.path, artifact.path);
      }
      otherAssets.push(artifact.path);
      continue;
    }
    for (const reference of references) {
      edits.overwrite(reference.start, reference.end, `url(data:${mime};base64,${markerB64})`);
    }
    if (!marked) {
      // Bun's copy is byte-identical to the source, so it stands in as the ref's file, minus the fixed-width asset
      // hash in its name that would otherwise double-hash the served one.
      refs.push({ path: path.join(path.dirname(artifact.path), path.basename(artifact.path, ext).replace(/-[a-z0-9]{8}$/, '') + ext), size: bytes.length, markerB64, bytes });
    }
    adopted.push(artifact.path);
  }
  return { css: edits.toString(), otherAssets, adopted, missing, unreadable };
}

// Entrypoints bundle in parallel and a font shared between stylesheets emits the same content-hashed copy from each,
// so one build can read the path another is mid-rewrite of and see zero bytes — reliably on Windows, which has no
// atomic replace. Every writer puts identical bytes there, so re-reading converges rather than racing forever.
async function readSettledBytes(artifactPath: string, file: Bun.BunFile): Promise<Uint8Array> {
  let bytes = await file.bytes();
  for (let attempt = 0; bytes.length === 0 && attempt < 50; attempt++) {
    await Bun.sleep(10);
    bytes = await Bun.file(artifactPath).bytes();
  }
  return bytes;
}

// Bun prints the emitted asset relative to the stylesheet: `./name.woff2`, `../name.woff2` or bare.
function namesEmittedFile(urlValue: string, fileName: string): boolean {
  const segments = urlValue.split('/');
  return segments.pop() === fileName && segments.every((segment) => segment === '.' || segment === '..');
}

/**
 * Classify the marker `data:` URIs a {@link createFontMarkerPlugin} build left in the bundled CSS: prune legacy woff
 * sources, decide preload-worthiness per `@font-face` block, and report every ref still referenced so the caller can
 * emit those files and substitute their `markerUri` with the final served URL.
 *
 * `parseFailed` means nothing was inspected, so any marker in the CSS is still sitting where a font should be.
 */
export function classifyFontAssets(css: string, refs: FontRef[], opts: { dropLegacyWoff: boolean }): { css: string; fonts: SurvivingFont[]; parseFailed: boolean } {
  // No zero-refs early return: legacy-woff pruning must still run when every font inlined for real (all under the
  // threshold, or the marker plugin skipped entirely via `inlineThreshold: Infinity`).
  const document = parseCss(css);
  if (!document) {
    return { css, fonts: [], parseFailed: true };
  }
  const refByMarker = new Map(refs.map((ref) => [ref.markerB64, ref]));

  const refByUrl = new Map<UrlRef, FontRef>();
  const urlsByRef = new Map<FontRef, UrlRef[]>();
  // The bundler decides the marker URI's exact text (MIME from the file extension), so capture it from the CSS rather
  // than re-deriving it.
  const found = new Map<FontRef, { contentType: string; markerUri: string; preload: boolean }>();
  for (const url of document.urls) {
    const data = parseDataUri(url.value);
    const ref = data ? refByMarker.get(data.base64) : undefined;
    if (!data || !ref) {
      continue;
    }
    refByUrl.set(url, ref);
    urlsByRef.set(ref, [...(urlsByRef.get(ref) ?? []), url]);
    if (!found.has(ref)) {
      found.set(ref, { contentType: data.mime.toLowerCase(), markerUri: url.value, preload: false });
    }
  }

  const edits = new MagicString(css);
  const dropped = new Set<UrlRef>();
  for (const face of document.fontFaces) {
    // Overlap with U+0000–00FF, the glyphs first paint always needs; a face visible there is worth preloading.
    const latinVisible = face.unicodeRanges === null || face.unicodeRanges.some((range) => range.lo <= 0xff);
    const formats = face.sources.map((source) => sourceFormat(source, source.url ? refByUrl.get(source.url) : undefined));
    // Only a woff2 this pipeline itself emits or inlines (a `data:` URI at this stage) justifies pruning the woff
    // fallback — an external woff2 (CDN url the bundler left alone) can be unreachable offline or blocked by CSP.
    const hasWoff2 = face.sources.some((source, i) => (formats[i] === 'woff2' || formats[i] === 'woff2-variations') && (source.url?.value.startsWith('data:') ?? false));

    const dropIndices = new Set<number>();
    face.sources.forEach((source, i) => {
      // Legacy woff goes whether inlined or marked — a data: URI copy is payload all the same.
      if (opts.dropLegacyWoff && hasWoff2 && formats[i] === 'woff' && source.url) {
        dropIndices.add(i);
        return;
      }
      const ref = source.url ? refByUrl.get(source.url) : undefined;
      // Keyed off the file extension, not the format() hint, so `woff2-variations` variable fonts preload too.
      if (ref && ref.path.endsWith('.woff2') && latinVisible) {
        const entry = found.get(ref);
        if (entry) {
          entry.preload = true;
        }
      }
    });

    const spans = removalSpans(face.sources, dropIndices);
    for (const span of spans) {
      edits.remove(span.start, span.end);
    }
    // removalSpans refuses to empty a descriptor, so a drop only counts once it hands back spans.
    if (spans.length > 0) {
      for (const index of dropIndices) {
        dropped.add(face.sources[index]!.url!);
      }
    }
  }

  // A ref whose sources were all pruned no longer occurs; a ref referenced outside any @font-face block still does.
  const fonts: SurvivingFont[] = [];
  for (const [ref, entry] of found) {
    if (urlsByRef.get(ref)?.some((url) => !dropped.has(url))) {
      fonts.push({ ref, ...entry });
    }
  }
  return { css: edits.toString(), fonts, parseFailed: false };
}

function sourceFormat(source: FontSource, ref: FontRef | undefined): string | null {
  if (source.format) {
    return source.format;
  }
  const pathLike = ref?.path ?? source.url?.value;
  if (!pathLike) {
    return null;
  }
  const mime = parseDataUri(pathLike)?.mime;
  if (mime) {
    return mime.toLowerCase().split('/').pop() ?? null;
  }
  return pathLike.split('?')[0]!.split('.').pop()?.toLowerCase() ?? null;
}

export function substituteFontUrls(css: string, urlByMarkerUri: Map<string, string>): string {
  const document = parseCss(css);
  if (!document) {
    return css;
  }
  const edits = new MagicString(css);
  for (const url of document.urls) {
    const fontUrl = urlByMarkerUri.get(url.value);
    if (fontUrl !== undefined) {
      edits.overwrite(url.start, url.end, `url(${fontUrl})`);
    }
  }
  return edits.toString();
}

export function stripFontFaces(css: string): { css: string; dropped: number } {
  const faces = parseCss(css)?.fontFaces ?? [];
  if (faces.length === 0) {
    return { css, dropped: 0 };
  }
  const edits = new MagicString(css);
  for (const face of faces) {
    edits.remove(face.start, face.end);
  }
  return { css: edits.toString(), dropped: faces.length };
}

export function fontAssetFileName(ref: FontRef, bytes: Uint8Array): string {
  const ext = path.extname(ref.path);
  const base = path.basename(ref.path, ext).replace(/[^\w-]/g, '-');
  return `${base}-${fontContentHash(bytes)}${ext}`;
}
