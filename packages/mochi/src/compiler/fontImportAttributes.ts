import path from 'node:path';
import * as acorn from 'acorn';
import { tsPlugin } from '@sveltejs/acorn-typescript';
import { preprocess } from 'svelte/compiler';
import type { CodepointRange } from './cssAst';

/** What one `import '…' with { subset: … }` asks the font pipeline to keep. */
export interface FontSubsetSpec {
  text: string;
  /** Pins a variable font's `wght` axis to one value, instancing it down to a static face. */
  weight: number | null;
  /** Keep glyphs only reachable through GSUB (ligatures, contextual alternates). `false` drops them, which is smaller but changes the rendering. */
  layoutClosure: boolean;
}

/** One import statement that carried import attributes. */
export interface ScannedImportAttributes {
  specifier: string;
  attributes: Record<string, string>;
  line: number;
}

/** Every spec of a stylesheet that names the same weight, merged — one `@font-face` variant per group. */
export interface FontSubsetGroup {
  weight: number | null;
  layoutClosure: boolean;
  /** Sorted, disjoint. */
  ranges: CodepointRange[];
}

export const FONT_SUBSET_ATTRIBUTE_KEYS = ['subset', 'weight', 'layoutClosure'] as const;

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
// a component script read identically; the latest ecmaVersion keeps pace with the syntax Bun itself compiles.
const JS_PARSER = acorn.Parser;
const TS_PARSER = JS_PARSER.extend(tsPlugin());
const JSX_PARSER = JS_PARSER.extend(tsPlugin({ jsx: true }));
const PARSE_OPTIONS: acorn.Options = {
  sourceType: 'module',
  ecmaVersion: 'latest',
  locations: true,
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowHashBang: true,
};

/**
 * Bun's bundler accepts unknown import attributes but strips them before any plugin hook runs, and its transpiler's
 * `scanImports()` drops them too, so the only place they can be read is the source, through the acorn Svelte itself
 * uses. `null` means a script could not be parsed, so whatever attributes the file carries are unknown.
 */
export async function scanImportAttributes(source: string, kind: ScriptKind): Promise<ScannedImportAttributes[] | null> {
  // An attribute list reads `with {`, so a file without that sequence is never parsed.
  if (!/\bwith\s*\{/.test(source)) {
    return [];
  }
  const scripts = kind === 'svelte' ? await svelteScripts(source) : [{ content: source, parser: parserFor(kind), lineOffset: 0 }];
  const found: ScannedImportAttributes[] = [];
  for (const { content, parser, lineOffset } of scripts) {
    let body: acorn.Program['body'];
    try {
      body = parser.parse(content, PARSE_OPTIONS).body;
    } catch {
      return null;
    }
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
      found.push({ specifier: node.source.value, attributes, line: node.loc!.start.line + lineOffset });
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

// The script blocks come from Svelte's own preprocessor tag extraction rather than its parser, which fails the whole
// file on a `<style lang="scss">` or any other block that only a preprocessor can read.
async function svelteScripts(source: string): Promise<{ content: string; parser: typeof acorn.Parser; lineOffset: number }[]> {
  const scripts: { content: string; parser: typeof acorn.Parser; lineOffset: number }[] = [];
  await preprocess(source, {
    script: ({ content, attributes }) => {
      // A typed block in the markup (JSON-LD, a template) is data, not a component script.
      if (typeof attributes.type === 'string' && attributes.type !== 'module') {
        return;
      }
      const lineOffset = source.slice(0, source.indexOf(content)).split('\n').length - 1;
      scripts.push({ content, parser: attributes.lang === 'ts' ? TS_PARSER : JS_PARSER, lineOffset });
    },
  });
  return scripts;
}

/**
 * Read a subset spec off a stylesheet import's attributes, or `null` when it carries none. A key or value that can't be
 * honoured is an error rather than a silent no-op: a typo in `weight` would otherwise ship the full variable file
 * without a word. Only stylesheet imports may be passed in, since attributes on any other import belong to the runtime.
 */
export function parseFontSubsetSpec(attributes: Record<string, string>): { spec: FontSubsetSpec | null; error: string | null } {
  const keys = Object.keys(attributes).filter((key) => key !== 'type');
  const unknown = keys.filter((key) => !(FONT_SUBSET_ATTRIBUTE_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return {
      spec: null,
      error: `unknown import attribute${unknown.length === 1 ? '' : 's'} ${unknown.map((key) => `"${key}"`).join(', ')}. Font subsetting understands ${FONT_SUBSET_ATTRIBUTE_KEYS.join(', ')}.`,
    };
  }
  if (keys.length === 0) {
    return { spec: null, error: null };
  }
  const text = attributes.subset ?? '';
  if (text.length === 0) {
    return { spec: null, error: 'nothing to keep — give the text in `subset`.' };
  }
  let weight: number | null = null;
  if (attributes.weight !== undefined) {
    weight = Number(attributes.weight);
    if (attributes.weight.trim() === '' || !Number.isFinite(weight) || weight <= 0) {
      return { spec: null, error: `weight "${attributes.weight}" is not a number.` };
    }
  }
  if (attributes.layoutClosure !== undefined && attributes.layoutClosure !== 'full' && attributes.layoutClosure !== 'none') {
    return { spec: null, error: `layoutClosure "${attributes.layoutClosure}" must be "full" (default) or "none".` };
  }
  return { spec: { text, weight, layoutClosure: attributes.layoutClosure !== 'none' }, error: null };
}

/** Sorted, disjoint ranges covering the same codepoints as `ranges`. */
export function mergeRanges(ranges: CodepointRange[]): CodepointRange[] {
  const merged: CodepointRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.lo - b.lo || a.hi - b.hi)) {
    const last = merged[merged.length - 1];
    if (last && range.lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, range.hi);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function textToRanges(text: string): CodepointRange[] {
  return mergeRanges(Array.from(text, (ch) => ({ lo: ch.codePointAt(0)!, hi: ch.codePointAt(0)! })));
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
      text += String.fromCodePoint(cp);
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

/**
 * Merge specs into one group per weight: `font-weight` is the only descriptor that lets the browser tell two subsets of
 * a family apart, so sites that agree on it share a face. That face drops layout closure only when all of them ask to.
 */
export function mergeFontSubsetSpecs(specs: Iterable<FontSubsetSpec>): FontSubsetGroup[] {
  const all = [...specs];
  // A face pinned to one weight wins that weight outright in the browser, hiding the text an unpinned face holds, so
  // one unpinned site keeps every site's text in a single variable face.
  const pinned = all.every((spec) => spec.weight !== null);
  const groups = new Map<number | null, { text: string; layoutClosure: boolean }>();
  for (const spec of all) {
    const weight = pinned ? spec.weight : null;
    const group = groups.get(weight) ?? { text: '', layoutClosure: false };
    group.text += spec.text;
    group.layoutClosure ||= spec.layoutClosure;
    groups.set(weight, group);
  }
  // Sorted so the result, and the fingerprint taken from it, doesn't depend on the order the importers were built in.
  return [...groups.entries()].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([weight, group]) => ({ weight, layoutClosure: group.layoutClosure, ranges: textToRanges(group.text) }));
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
    out[family] = mergeRanges(ranges).map((range) => [range.lo, range.hi]);
  }
  return out;
}
