import { parse } from 'svelte/compiler';
import { parseUnicodeRange, type CodepointRange } from './cssAst';

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

/** One side-effect import statement that carried import attributes. */
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

/**
 * Bun's bundler accepts unknown import attributes but strips them before any plugin hook runs, so the only place they
 * can be read is the source text. `.svelte` files go through Svelte's own parser; scripts get a lexical scan that
 * skips strings and comments, since Bun's transpiler drops attributes from its output too.
 */
export function scanImportAttributes(source: string, kind: 'svelte' | 'script'): ScannedImportAttributes[] {
  if (!/\bwith\s*\{/.test(source)) {
    return [];
  }
  return kind === 'svelte' ? scanSvelte(source) : scanScript(source);
}

interface EstreeImportAttribute {
  key: { type: string; name?: string; value?: unknown };
  value: { value?: unknown };
}

function scanSvelte(source: string): ScannedImportAttributes[] {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { modern: true });
  } catch {
    // A syntax error is the compiler's to report; there is nothing to subset until it does.
    return [];
  }
  const found: ScannedImportAttributes[] = [];
  for (const script of [ast.module, ast.instance]) {
    for (const node of script?.content.body ?? []) {
      if (node.type !== 'ImportDeclaration' || typeof node.source.value !== 'string') {
        continue;
      }
      const raw = (node as { attributes?: EstreeImportAttribute[] }).attributes ?? [];
      if (raw.length === 0) {
        continue;
      }
      const attributes: Record<string, string> = {};
      for (const attribute of raw) {
        const key = attribute.key.type === 'Identifier' ? attribute.key.name : attribute.key.value;
        if (typeof key === 'string' && typeof attribute.value.value === 'string') {
          attributes[key] = attribute.value.value;
        }
      }
      found.push({ specifier: node.source.value, attributes, line: lineAt(source, (node as { start: number }).start) });
    }
  }
  return found;
}

const IMPORT_WITH = /import\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s*with\s*\{/y;
const IDENT_CHAR = /[\w$]/;

function scanScript(source: string): ScannedImportAttributes[] {
  const found: ScannedImportAttributes[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const ch = source[i]!;
    if (ch === '\n') {
      line++;
      i++;
    } else if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      line += countNewlines(source, i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const stop = skipString(source, i);
      line += countNewlines(source, i, stop);
      i = stop;
    } else if (ch === 'i' && source.startsWith('import', i) && (i === 0 || !IDENT_CHAR.test(source[i - 1]!))) {
      IMPORT_WITH.lastIndex = i;
      const match = IMPORT_WITH.exec(source);
      if (!match) {
        i += 'import'.length;
        continue;
      }
      const parsed = readAttributeList(source, IMPORT_WITH.lastIndex);
      if (parsed) {
        found.push({ specifier: decodeStringLiteral(match[2]!), attributes: parsed.attributes, line });
        line += countNewlines(source, i, parsed.end);
        i = parsed.end;
      } else {
        i = IMPORT_WITH.lastIndex;
      }
    } else {
      i++;
    }
  }
  return found;
}

const WHITESPACE_OR_COMMA = /[\s,]/;
const IDENT = /[A-Za-z_$][\w$]*/y;

// Attribute values are string literals by the language grammar (TS enforces it as TS2858), so a list that fails to
// parse as `key: 'string'` pairs is malformed rather than dynamic, and is left for the compiler to reject.
function readAttributeList(source: string, from: number): { attributes: Record<string, string>; end: number } | null {
  const attributes: Record<string, string> = {};
  let i = from;
  while (i < source.length) {
    while (i < source.length && WHITESPACE_OR_COMMA.test(source[i]!)) {
      i++;
    }
    if (source[i] === '}') {
      return { attributes, end: i + 1 };
    }
    let key: string;
    if (source[i] === '"' || source[i] === "'") {
      const end = skipString(source, i);
      key = decodeStringLiteral(source.slice(i + 1, end - 1));
      i = end;
    } else {
      IDENT.lastIndex = i;
      const match = IDENT.exec(source);
      if (!match) {
        return null;
      }
      key = match[0];
      i = IDENT.lastIndex;
    }
    while (i < source.length && /\s/.test(source[i]!)) {
      i++;
    }
    if (source[i] !== ':') {
      return null;
    }
    i++;
    while (i < source.length && /\s/.test(source[i]!)) {
      i++;
    }
    if (source[i] !== '"' && source[i] !== "'") {
      return null;
    }
    const end = skipString(source, i);
    attributes[key] = decodeStringLiteral(source.slice(i + 1, end - 1));
    i = end;
  }
  return null;
}

/** Index just past the closing quote of the string literal opening at `from`, or the end of input when unterminated. */
function skipString(source: string, from: number): number {
  const quote = source[from]!;
  let i = from + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 2;
    } else if (ch === quote) {
      return i + 1;
    } else if (ch === '\n' && quote !== '`') {
      return i;
    } else {
      i++;
    }
  }
  return source.length;
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };

function decodeStringLiteral(body: string): string {
  return body.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r?\n|(.))/g, (_, _whole, braced, u4, x2, other) => {
    if (braced) {
      return String.fromCodePoint(parseInt(braced, 16));
    }
    if (u4) {
      return String.fromCharCode(parseInt(u4, 16));
    }
    if (x2) {
      return String.fromCharCode(parseInt(x2, 16));
    }
    if (other === undefined) {
      return '';
    }
    return SIMPLE_ESCAPES[other] ?? other;
  });
}

function countNewlines(source: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i++) {
    if (source.charCodeAt(i) === 10) {
      count++;
    }
  }
  return count;
}

function lineAt(source: string, offset: number): number {
  return 1 + countNewlines(source, 0, offset);
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
  const unicodeRanges: CodepointRange[] = [];
  if (attributes.unicodeRange !== undefined) {
    for (const token of attributes.unicodeRange.split(/[\s,]+/).filter(Boolean)) {
      const range = parseUnicodeRange(token);
      if (!range) {
        return { spec: null, error: `unicodeRange entry "${token}" is not a CSS unicode-range like U+0020-007E.` };
      }
      unicodeRanges.push(range);
    }
  }
  if (text.length === 0 && unicodeRanges.length === 0) {
    return { spec: null, error: 'nothing to keep — give the text in `subset` and/or codepoints in `unicodeRange`.' };
  }
  const axes: Record<string, number> = {};
  if (attributes.weight !== undefined) {
    const weight = Number(attributes.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return { spec: null, error: `weight "${attributes.weight}" is not a number.` };
    }
    axes.wght = weight;
  }
  if (attributes.axes !== undefined) {
    for (const entry of attributes.axes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [tag, valueText, ...rest] = entry.split('=').map((s) => s.trim());
      const value = Number(valueText);
      if (!tag || !/^[\w]{1,4}$/.test(tag) || valueText === undefined || rest.length > 0 || !Number.isFinite(value)) {
        return { spec: null, error: `axes entry "${entry}" is not tag=value (e.g. "wdth=100, slnt=-10").` };
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
