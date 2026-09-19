// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../subset-font.d.ts" />
import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import { parseCss, type CodepointRange, type FontFace } from './cssAst';
import { fontContentHash, type FontRef, type SurvivingFont } from './cssFontAssets';
import { axesKey, intersectRanges, rangesToText, type FontSubsetGroup } from './fontImportAttributes';

type SubsetFont = typeof import('subset-font').default;

export class FontSubsetterUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'font subsetting needs the optional `subset-font` package (HarfBuzz compiled to WebAssembly): run `bun add -d subset-font`, ' +
        'or remove the `subset` import attribute to ship the full font.',
      { cause },
    );
    this.name = 'FontSubsetterUnavailableError';
  }
}

let subsetter: Promise<SubsetFont> | undefined;

/** Loads HarfBuzz on first use only, so apps without a `subset` attribute never pay for the WASM. */
export function loadFontSubsetter(): Promise<SubsetFont> {
  subsetter ??= import('subset-font').then(
    (mod) => mod.default,
    (cause: unknown) => {
      subsetter = undefined;
      throw new FontSubsetterUnavailableError(cause);
    },
  );
  return subsetter;
}

const TARGET_FORMAT_BY_EXT: Record<string, 'sfnt' | 'woff' | 'woff2'> = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'sfnt', '.otf': 'sfnt' };
const ALL_CODEPOINTS: CodepointRange[] = [{ lo: 0, hi: 0x10ffff }];

export interface FontSubsetVariant {
  ref: FontRef;
  family: string | null;
  ranges: CodepointRange[];
  axes: Record<string, number>;
  layoutClosure: boolean;
  bytes: Uint8Array;
  /** Small enough for `inlineThreshold`, so it became a `data:` URI and no file or preload exists. */
  inlined: boolean;
  /** Served URL when emitted as a file. */
  url: string | null;
  preload: boolean;
}

export interface ApplyFontSubsetsOptions {
  inlineThreshold: number;
  /** Directory for reusing earlier subset output across rebundles; omit to always recompute. */
  cacheDir?: string;
  subset: SubsetFont;
  readSource: (ref: FontRef) => Promise<Uint8Array>;
  /** Writes an emitted subset beside the other extracted fonts and returns its served URL. */
  emit: (ref: FontRef, bytes: Uint8Array, contentType: string) => Promise<string>;
}

export interface ApplyFontSubsetsResult {
  css: string;
  variants: FontSubsetVariant[];
  /** Faces whose `unicode-range` shares nothing with the request, removed outright. */
  droppedFaces: number;
}

/**
 * Rewrite every `@font-face` that references an extracted font into one block per subset group, pointing at the
 * subset bytes instead of the full file. Sources whose format HarfBuzz can't write (eot) keep their marker and fall
 * through to the regular extraction. Runs after {@link classifyFontAssets}, on its output.
 */
export async function applyFontSubsets(css: string, fonts: SurvivingFont[], groups: FontSubsetGroup[], opts: ApplyFontSubsetsOptions): Promise<ApplyFontSubsetsResult> {
  const document = parseCss(css);
  if (!document || groups.length === 0) {
    return { css, variants: [], droppedFaces: 0 };
  }
  const fontByMarker = new Map(fonts.map((font) => [font.markerUri, font]));
  const edits = new MagicString(css);
  const variants: FontSubsetVariant[] = [];
  const sourceBytes = new Map<FontRef, Promise<Uint8Array>>();
  let droppedFaces = 0;

  for (const face of document.fontFaces) {
    const subsettable = face.sources.filter(
      (source) => source.url && fontByMarker.has(source.url.value) && TARGET_FORMAT_BY_EXT[extOf(fontByMarker.get(source.url.value)!.ref)] !== undefined,
    );
    if (subsettable.length === 0) {
      continue;
    }
    const faceRanges = face.unicodeRanges ?? ALL_CODEPOINTS;
    const kept = groups.map((group) => ({ group, ranges: intersectRanges(group.ranges, faceRanges) })).filter((entry) => entry.ranges.length > 0);
    if (kept.length === 0) {
      edits.remove(face.start, face.end);
      droppedFaces++;
      continue;
    }
    const blocks: string[] = [];
    for (const { group, ranges } of kept) {
      const block = new MagicString(css.slice(face.start, face.end));
      const local = (span: { start: number; end: number }) => ({ start: span.start - face.start, end: span.end - face.start });
      for (const source of subsettable) {
        const font = fontByMarker.get(source.url!.value)!;
        const bytes = await subsetBytes(font, ranges, group, opts, sourceBytes);
        const inlined = bytes.length <= opts.inlineThreshold;
        const url = inlined ? `data:${font.contentType};base64,${Buffer.from(bytes).toString('base64')}` : await opts.emit(font.ref, bytes, font.contentType);
        const { start, end } = local(source.url!);
        block.overwrite(start, end, `url(${url})`);
        if (Object.keys(group.axes).length > 0 && source.formatArg && source.format?.endsWith('-variations')) {
          const keyword = source.format.slice(0, -'-variations'.length);
          const arg = local(source.formatArg);
          block.overwrite(arg.start, arg.end, source.formatArg.quoted ? `"${keyword}"` : keyword);
        }
        variants.push({
          ref: font.ref,
          family: face.family,
          ranges,
          axes: group.axes,
          layoutClosure: group.layoutClosure,
          bytes,
          inlined,
          url: inlined ? null : url,
          // Same rule as the unsubsetted path, on the codepoints actually kept: a woff2 the first paint can use.
          preload: !inlined && extOf(font.ref) === '.woff2' && ranges.some((range) => range.lo <= 0xff),
        });
      }
      pinDescriptor(block, face, face.weight, 'font-weight', group.axes.wght === undefined ? undefined : String(group.axes.wght), local);
      pinDescriptor(block, face, face.stretch, 'font-stretch', group.axes.wdth === undefined ? undefined : `${group.axes.wdth}%`, local);
      blocks.push(block.toString());
    }
    edits.overwrite(face.start, face.end, blocks.join('\n'));
  }
  return { css: edits.toString(), variants, droppedFaces };
}

// A pinned axis must show in the descriptor too, or the browser treats the static face as covering the whole range
// and renders every weight with the one instance, with no synthesis and no fallback.
function pinDescriptor(
  block: MagicString,
  face: FontFace,
  span: { start: number; end: number } | null,
  property: string,
  value: string | undefined,
  local: (span: { start: number; end: number }) => { start: number; end: number },
): void {
  if (value === undefined) {
    return;
  }
  if (span) {
    const { start, end } = local(span);
    block.overwrite(start, end, value);
  } else {
    block.appendLeft(face.end - face.start - 1, `${property}:${value};`);
  }
}

async function subsetBytes(
  font: SurvivingFont,
  ranges: CodepointRange[],
  group: FontSubsetGroup,
  opts: ApplyFontSubsetsOptions,
  sourceBytes: Map<FontRef, Promise<Uint8Array>>,
): Promise<Uint8Array> {
  const ext = extOf(font.ref);
  const targetFormat = TARGET_FORMAT_BY_EXT[ext]!;
  let source = sourceBytes.get(font.ref);
  if (!source) {
    source = opts.readSource(font.ref);
    sourceBytes.set(font.ref, source);
  }
  const bytes = await source;
  const key = fontContentHash(
    Buffer.from(`${fontContentHash(bytes)}|${JSON.stringify(ranges.map((range) => [range.lo, range.hi]))}|${axesKey(group.axes)}|${group.layoutClosure}|${targetFormat}`),
  );
  const cachePath = opts.cacheDir ? path.join(opts.cacheDir, `${key}${ext}`) : null;
  if (cachePath && fs.existsSync(cachePath)) {
    return Bun.file(cachePath).bytes();
  }
  let subset: Buffer;
  try {
    subset = await opts.subset(Buffer.from(bytes), rangesToText(ranges), {
      targetFormat,
      variationAxes: Object.keys(group.axes).length > 0 ? group.axes : undefined,
      noLayoutClosure: !group.layoutClosure,
    });
  } catch (cause) {
    throw new Error(`subsetting ${path.basename(font.ref.path)} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  if (cachePath) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // Written under a private name and renamed, so a parallel bundle of a stylesheet sharing the font never reads a half-written cache entry.
    const staging = `${cachePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await Bun.write(staging, subset);
    try {
      fs.renameSync(staging, cachePath);
    } catch {
      fs.rmSync(staging, { force: true });
    }
  }
  return new Uint8Array(subset.buffer, subset.byteOffset, subset.byteLength);
}

function extOf(ref: FontRef): string {
  return path.extname(ref.path).toLowerCase();
}
