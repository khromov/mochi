import path from 'node:path';
import * as acorn from 'acorn';
import { tsPlugin } from '@sveltejs/acorn-typescript';
import { parse as parseSvelte } from 'svelte/compiler';
import { parseUnicodeRangeList, type CodepointRange } from './cssAst';

/**
 * What one `import '…' with { subset: … }` asks the font pipeline to keep. Every field is a union-friendly shape: two
 * sites naming the same stylesheet merge by concatenating `text` / `unicodeRanges` when their `axes` and
 * `layoutClosure` agree, and otherwise become separate `@font-face` variants.
 */
export interface FontSubsetSpec {
  text: string;
  unicodeRanges: CodepointRange[];
  /** Variation axes pinned to one value (`{ wght: 500 }`), instancing the variable font down to a static face. */
  axes: Record<string, number>;
  /** Keep glyphs only reachable through GSUB (ligatures, contextual alternates). `false` drops them, which is smaller but changes the rendering. */
  layoutClosure: boolean;
}

/** One import statement that carried import attributes. */
export interface ScannedImportAttributes {
  specifier: string;
  attributes: Record<string, string>;
  line: number;
}

/** A merged set of specs sharing axes and closure — one `@font-face` variant per group. */
export interface FontSubsetGroup {
  axes: Record<string, number>;
  layoutClosure: boolean;
  /** Sorted, disjoint. */
  ranges: CodepointRange[];
}

export const FONT_SUBSET_ATTRIBUTE_KEYS = ['subset', 'unicodeRange', 'weight', 'axes', 'layoutClosure'] as const;

export type ScriptKind = 'svelte' | 'js' | 'jsx' | 'ts' | 'tsx';

/** Which parser a source file needs, or null for a file that holds no script (CSS, images, markdown). */
export function scriptKindOf(filePath: string): ScriptKind | null {
  switch (path.extname(filePath).toLowerCase()) {
    case '.svelte':
      return 'svelte';
    case '.ts':
    case '.mts':
    case '.cts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'js';
    case '.jsx':
      return 'jsx';
    default:
      return null;
  }
}

// The parsers Svelte itself builds for `<script>` blocks (svelte/src/compiler/phases/1-parse/acorn.js), so a module and
// a component script read identically; ecmaVersion 16 is where acorn admits import attributes.
const JS_PARSER = acorn.Parser;
const TS_PARSER = JS_PARSER.extend(tsPlugin());
const JSX_PARSER = JS_PARSER.extend(tsPlugin({ jsx: true }));
const PARSE_OPTIONS: acorn.Options = {
  sourceType: 'module',
  ecmaVersion: 16,
  locations: true,
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowHashBang: true,
};

/**
 * Bun's bundler accepts unknown import attributes but strips them before any plugin hook runs, and its transpiler's
 * `scanImports()` drops them too, so the only place they can be read is the source: `.svelte` files through Svelte's
 * parser, scripts through the same acorn it uses. A file that can't parse yields nothing — the syntax error is the
 * compiler's to report.
 */
export function scanImportAttributes(source: string, kind: ScriptKind): ScannedImportAttributes[] {
  // An attribute list needs the `with` keyword, so the many files without the word skip the parse.
  if (!source.includes('with')) {
    return [];
  }
  let bodies: acorn.Program['body'][];
  try {
    bodies = kind === 'svelte' ? svelteScriptBodies(source) : [parserFor(kind).parse(source, PARSE_OPTIONS).body];
  } catch {
    return [];
  }
  const found: ScannedImportAttributes[] = [];
  for (const body of bodies) {
    for (const node of body) {
      // acorn leaves `attributes` off an import that has no `with` clause (and off TypeScript's `import type`).
      if (node.type !== 'ImportDeclaration' || typeof node.source.value !== 'string' || !node.attributes?.length) {
        continue;
      }
      const attributes: Record<string, string> = {};
      for (const attribute of node.attributes) {
        const key = attribute.key.type === 'Identifier' ? attribute.key.name : attribute.key.value;
        if (typeof key === 'string' && typeof attribute.value.value === 'string') {
          attributes[key] = attribute.value.value;
        }
      }
      found.push({ specifier: node.source.value, attributes, line: node.loc!.start.line });
    }
  }
  return found;
}

function parserFor(kind: Exclude<ScriptKind, 'svelte'>): typeof acorn.Parser {
  switch (kind) {
    case 'ts':
      return TS_PARSER;
    case 'tsx':
    case 'jsx':
      return JSX_PARSER;
    case 'js':
      return JS_PARSER;
  }
}

// Svelte parses its scripts with acorn too, so the bodies are the same node shapes with file-relative locations.
function svelteScriptBodies(source: string): acorn.Program['body'][] {
  const ast = parseSvelte(source, { modern: true });
  return [ast.module, ast.instance].flatMap((script) => (script ? [(script.content as unknown as acorn.Program).body] : []));
}

/**
 * Read a subset spec off an import's attributes, or `null` when none of the font keys are present (so an unrelated
 * `with { type: … }` passes through untouched). A font key with a value that can't be honoured is an error rather
 * than a silent no-op: a typo in `weight` would otherwise ship the full variable file without a word.
 */
export function parseFontSubsetSpec(attributes: Record<string, string>): { spec: FontSubsetSpec | null; error: string | null } {
  const keys = Object.keys(attributes);
  const fontKeys = keys.filter((key) => (FONT_SUBSET_ATTRIBUTE_KEYS as readonly string[]).includes(key));
  const unknown = keys.filter((key) => key !== 'type' && !fontKeys.includes(key));
  if (unknown.length > 0) {
    return {
      spec: null,
      error: `unknown import attribute${unknown.length === 1 ? '' : 's'} ${unknown.map((key) => `"${key}"`).join(', ')}. Font subsetting understands ${FONT_SUBSET_ATTRIBUTE_KEYS.join(', ')}.`,
    };
  }
  if (fontKeys.length === 0) {
    return { spec: null, error: null };
  }
  const text = attributes.subset ?? '';
  let unicodeRanges: CodepointRange[] = [];
  if (attributes.unicodeRange !== undefined) {
    const ranges = parseUnicodeRangeList(attributes.unicodeRange);
    if (!ranges) {
      return { spec: null, error: `unicodeRange "${attributes.unicodeRange}" is not a list of CSS unicode-range values like U+0020-007E.` };
    }
    unicodeRanges = ranges;
  }
  if (text.length === 0 && unicodeRanges.length === 0) {
    return { spec: null, error: 'nothing to keep — give the text in `subset` and/or codepoints in `unicodeRange`.' };
  }
  const axes: Record<string, number> = {};
  if (attributes.weight !== undefined) {
    const weight = Number(attributes.weight);
    if (attributes.weight.trim() === '' || !Number.isFinite(weight) || weight <= 0) {
      return { spec: null, error: `weight "${attributes.weight}" is not a number.` };
    }
    axes.wght = weight;
  }
  if (attributes.axes !== undefined) {
    for (const entry of attributes.axes.split(',')) {
      const pair = entry.trim();
      if (pair === '') {
        continue;
      }
      const equals = pair.indexOf('=');
      const tag = equals === -1 ? '' : pair.slice(0, equals).trim();
      const valueText = equals === -1 ? '' : pair.slice(equals + 1).trim();
      const value = Number(valueText);
      if (!isAxisTag(tag) || valueText === '' || !Number.isFinite(value)) {
        return { spec: null, error: `axes entry "${pair}" is not tag=value (e.g. "wdth=100, slnt=-10").` };
      }
      axes[tag] = value;
    }
  }
  let layoutClosure = true;
  if (attributes.layoutClosure !== undefined) {
    if (attributes.layoutClosure !== 'full' && attributes.layoutClosure !== 'none') {
      return { spec: null, error: `layoutClosure "${attributes.layoutClosure}" must be "full" (default) or "none".` };
    }
    layoutClosure = attributes.layoutClosure === 'full';
  }
  return { spec: { text, unicodeRanges, axes, layoutClosure }, error: null };
}

// An OpenType axis tag: one to four printable ASCII characters.
function isAxisTag(tag: string): boolean {
  if (tag.length === 0 || tag.length > 4) {
    return false;
  }
  for (const ch of tag) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

/** Sorted, disjoint ranges covering every codepoint in `text` and `ranges`. */
export function normalizeRanges(text: string, ranges: CodepointRange[]): CodepointRange[] {
  const all: CodepointRange[] = ranges.map((range) => ({ lo: Math.min(range.lo, range.hi), hi: Math.max(range.lo, range.hi) }));
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    all.push({ lo: cp, hi: cp });
  }
  all.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const merged: CodepointRange[] = [];
  for (const range of all) {
    const last = merged[merged.length - 1];
    if (last && range.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, range.hi);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function intersectRanges(a: CodepointRange[], b: CodepointRange[]): CodepointRange[] {
  const out: CodepointRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]!.lo, b[j]!.lo);
    const hi = Math.min(a[i]!.hi, b[j]!.hi);
    if (lo <= hi) {
      out.push({ lo, hi });
    }
    if (a[i]!.hi < b[j]!.hi) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

export function rangesToText(ranges: CodepointRange[]): string {
  let text = '';
  for (const range of ranges) {
    for (let cp = range.lo; cp <= range.hi; cp++) {
      // Surrogate codepoints are not characters; a range straddling them (a wide `U+D000-E000`) skips that gap.
      if (cp < 0xd800 || cp > 0xdfff) {
        text += String.fromCodePoint(cp);
      }
    }
  }
  return text;
}

export function formatRanges(ranges: CodepointRange[]): string {
  return ranges.map((range) => (range.lo === range.hi ? `U+${hex(range.lo)}` : `U+${hex(range.lo)}-${hex(range.hi)}`)).join(', ');
}

function hex(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, '0');
}

export function axesKey(axes: Record<string, number>): string {
  return Object.keys(axes)
    .sort()
    .map((tag) => `${tag}=${axes[tag]}`)
    .join(',');
}

/** Merge specs into one group per (axes, closure), so sites that agree share a face and ones that don't get their own. */
export function mergeFontSubsetSpecs(specs: Iterable<FontSubsetSpec>): FontSubsetGroup[] {
  const groups = new Map<string, { axes: Record<string, number>; layoutClosure: boolean; text: string; ranges: CodepointRange[] }>();
  for (const spec of specs) {
    const key = `${axesKey(spec.axes)}|${spec.layoutClosure}`;
    const group = groups.get(key) ?? { axes: { ...spec.axes }, layoutClosure: spec.layoutClosure, text: '', ranges: [] };
    group.text += spec.text;
    group.ranges.push(...spec.unicodeRanges);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({ axes: group.axes, layoutClosure: group.layoutClosure, ranges: normalizeRanges(group.text, group.ranges) }));
}

/** Stable identity of a stylesheet's merged subset request, so a changed attribute re-bundles and an unchanged one doesn't. */
export function fontSubsetFingerprint(groups: FontSubsetGroup[]): string {
  return JSON.stringify(groups.map((group) => [axesKey(group.axes), group.layoutClosure, group.ranges.map((range) => [range.lo, range.hi])]));
}

/** The kept codepoints of every subsetted face on a page, by lowercased family, in the shape the dev-mode browser check reads. */
export function rangesByFamily(faces: { family: string; ranges: CodepointRange[] }[]): Record<string, [number, number][]> {
  const collected = new Map<string, CodepointRange[]>();
  for (const face of faces) {
    const key = face.family.toLowerCase();
    collected.set(key, [...(collected.get(key) ?? []), ...face.ranges]);
  }
  const out: Record<string, [number, number][]> = {};
  for (const [family, ranges] of collected) {
    out[family] = normalizeRanges('', ranges).map((range) => [range.lo, range.hi]);
  }
  return out;
}
