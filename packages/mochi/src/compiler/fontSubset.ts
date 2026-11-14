// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../subset-font.d.ts" />
import path from 'node:path';
import MagicString from 'magic-string';
import { parseCss, type CodepointRange, type FontFace, type Span } from './cssAst';
import type { FontRef, SurvivingFont } from './cssFontAssets';
import { intersectRanges, rangesToText, type FontSubsetGroup } from './fontImportAttributes';

const TARGET_FORMAT_BY_EXT: Record<string, 'sfnt' | 'woff' | 'woff2'> = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'sfnt', '.otf': 'sfnt' };
const ALL_CODEPOINTS: CodepointRange[] = [{ lo: 0, hi: 0x10ffff }];

export interface FontSubsetVariant {
  ref: FontRef;
  family: string | null;
  ranges: CodepointRange[];
  weight: number | null;
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
      const local = (span: Span) => ({ start: span.start - face.start, end: span.end - face.start });
      for (const source of subsettable) {
        const font = fontByMarker.get(source.url!.value)!;
        let read = sourceBytes.get(font.ref);
        if (!read) {
          read = opts.readSource(font.ref);
          sourceBytes.set(font.ref, read);
        }
        const bytes = await subsetBytes(font.ref, await read, ranges, group);
        const inlined = bytes.length <= opts.inlineThreshold;
        const url = inlined ? `data:${font.contentType};base64,${Buffer.from(bytes).toString('base64')}` : await opts.emit(font.ref, bytes, font.contentType);
        const { start, end } = local(source.url!);
        block.overwrite(start, end, `url(${url})`);
        if (group.weight !== null && source.formatArg && source.format?.endsWith('-variations')) {
          const keyword = source.format.slice(0, -'-variations'.length);
          const arg = local(source.formatArg);
          block.overwrite(arg.start, arg.end, source.formatArg.quoted ? `"${keyword}"` : keyword);
        }
        variants.push({
          ref: font.ref,
          family: face.family,
          ranges,
          weight: group.weight,
          layoutClosure: group.layoutClosure,
          bytes,
          inlined,
          url: inlined ? null : url,
          // Same rule as the unsubsetted path, on the codepoints actually kept: a woff2 the first paint can use.
          preload: !inlined && extOf(font.ref) === '.woff2' && ranges.some((range) => range.lo <= 0xff),
        });
      }
      if (group.weight !== null) {
        pinWeight(block, face, group.weight);
      }
      blocks.push(block.toString());
    }
    edits.overwrite(face.start, face.end, blocks.join('\n'));
  }
  return { css: edits.toString(), variants, droppedFaces };
}

// A pinned weight must show in the descriptor too, or the browser treats the static face as covering the whole range
// and renders every weight with the one instance, with no synthesis and no fallback.
function pinWeight(block: MagicString, face: FontFace, weight: number): void {
  if (face.weight) {
    block.overwrite(face.weight.start - face.start, face.weight.end - face.start, String(weight));
    return;
  }
  // Minified output drops the `;` after the last declaration, so the new one supplies its own separator.
  const closing = face.end - face.start - 1;
  const before = block.original.slice(0, closing).trimEnd();
  const separator = before.endsWith(';') || before.endsWith('{') ? '' : ';';
  block.appendLeft(closing, `${separator}font-weight:${weight};`);
}

async function subsetBytes(ref: FontRef, source: Uint8Array, ranges: CodepointRange[], group: FontSubsetGroup): Promise<Uint8Array> {
  try {
    // Imported on first use only, so an app without a `subset` attribute never loads HarfBuzz's WebAssembly.
    const { default: subsetFont } = await import('subset-font');
    const subset = await subsetFont(Buffer.from(source), rangesToText(ranges), {
      targetFormat: TARGET_FORMAT_BY_EXT[extOf(ref)]!,
      variationAxes: group.weight === null ? undefined : { wght: group.weight },
      noLayoutClosure: !group.layoutClosure,
    });
    return new Uint8Array(subset.buffer, subset.byteOffset, subset.byteLength);
  } catch (cause) {
    throw new Error(`subsetting ${path.basename(ref.path)} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

function extOf(ref: FontRef): string {
  return path.extname(ref.path).toLowerCase();
}
