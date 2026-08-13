// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../css-tree.d.ts" />
import type { Atrule, CssNode, FunctionNode, UnicodeRange, Value } from 'css-tree';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';

/** Half-open `[start, end)` offsets into the parsed CSS. */
export interface Span {
  start: number;
  end: number;
}

export interface UrlRef extends Span {
  /** Quotes stripped and escapes decoded, not the raw source text. */
  value: string;
}

export interface CodepointRange {
  lo: number;
  hi: number;
}

/** One comma-separated entry of a `src:` descriptor. */
export interface FontSource extends Span {
  /** Null for a `local()` source, which names an installed face rather than a file. */
  url: UrlRef | null;
  /** Lowercased `format()` keyword. */
  format: string | null;
  commaBefore: Span | null;
  commaAfter: Span | null;
}

/** Spans cover the whole at-rule through its closing brace. */
export interface FontFace extends Span {
  sources: FontSource[];
  /** Null when the face declares no `unicode-range`, and so covers everything. */
  unicodeRanges: CodepointRange[] | null;
}

export interface CssDocument {
  urls: UrlRef[];
  /** Nested faces included, so one inside `@media` is still found. */
  fontFaces: FontFace[];
}

/**
 * Parse a stylesheet into the shapes the font pipeline needs, or null if css-tree gives up. Callers splice the
 * original text over the returned spans — css-tree's printer drops comments and re-encodes `url()`, so it goes unused.
 */
export function parseCss(css: string): CssDocument | null {
  let ast: CssNode;
  try {
    // Custom properties keep their value as a Raw node by default, hiding any url() inside one.
    ast = parse(css, { positions: true, parseCustomProperty: true });
  } catch {
    return null;
  }

  const urls: UrlRef[] = [];
  const urlByOffset = new Map<number, UrlRef>();
  walk(ast, {
    visit: 'Url',
    enter(node) {
      const ref = { value: node.value, ...spanOf(node) };
      urls.push(ref);
      urlByOffset.set(ref.start, ref);
    },
  });

  const fontFaces: FontFace[] = [];
  walk(ast, {
    visit: 'Atrule',
    enter(node) {
      if (node.name.toLowerCase() === 'font-face') {
        fontFaces.push(readFontFace(node, urlByOffset));
      }
    },
  });

  return { urls, fontFaces };
}

/** `data:<mime>;base64,<payload>` — the only `data:` form Bun's CSS bundler emits. */
export function parseDataUri(value: string): { mime: string; base64: string } | null {
  if (!value.startsWith('data:')) {
    return null;
  }
  const separator = value.indexOf(';base64,');
  if (separator === -1) {
    return null;
  }
  const mime = value.slice('data:'.length, separator);
  if (mime.length === 0 || mime.includes(',') || mime.includes(';')) {
    return null;
  }
  return { mime, base64: value.slice(separator + ';base64,'.length) };
}

/** `U+0131`, `U+0000-00FF` or a wildcard `U+00??`, which spans every codepoint the `?`s can fill. */
export function parseUnicodeRange(text: string): CodepointRange | null {
  if (text.slice(0, 2).toLowerCase() !== 'u+') {
    return null;
  }
  const body = text.slice(2);
  const dash = body.indexOf('-');
  const lo = hexValue(dash === -1 ? body : body.slice(0, dash), '0');
  const hi = dash === -1 ? hexValue(body, 'f') : hexValue(body.slice(dash + 1), 'f');
  return lo !== null && hi !== null ? { lo, hi } : null;
}

const HEX_DIGITS = '0123456789abcdef';

function hexValue(text: string, wildcardFill: '0' | 'f'): number | null {
  if (text.length === 0 || text.length > 6) {
    return null;
  }
  let value = 0;
  for (const ch of text.toLowerCase()) {
    const digit = HEX_DIGITS.indexOf(ch === '?' ? wildcardFill : ch);
    if (digit === -1) {
      return null;
    }
    value = value * 16 + digit;
  }
  return value;
}

function spanOf(node: CssNode): Span {
  return { start: node.loc!.start.offset, end: node.loc!.end.offset };
}

function readFontFace(face: Atrule, urlByOffset: Map<number, UrlRef>): FontFace {
  const src = findDescriptor(face, 'src');
  const range = findDescriptor(face, 'unicode-range');
  return {
    ...spanOf(face),
    sources: src ? readSources(src, urlByOffset) : [],
    unicodeRanges: range ? readUnicodeRanges(range) : null,
  };
}

function readUnicodeRanges(value: Value): CodepointRange[] {
  return [...value.children]
    .filter((node): node is UnicodeRange => node.type === 'UnicodeRange')
    .map((node) => parseUnicodeRange(node.value))
    .filter((range) => range !== null);
}

/** A descriptor whose value css-tree could not parse comes back as Raw, which has no structure worth reading. */
function findDescriptor(face: Atrule, property: string): Value | null {
  for (const node of face.block?.children ?? []) {
    if (node.type === 'Declaration' && node.property.toLowerCase() === property && node.value.type === 'Value') {
      return node.value;
    }
  }
  return null;
}

interface SourceGroup {
  nodes: CssNode[];
  commaBefore: Span | null;
  commaAfter: Span | null;
}

function readSources(value: Value, urlByOffset: Map<number, UrlRef>): FontSource[] {
  const groups: SourceGroup[] = [];
  let current: SourceGroup = { nodes: [], commaBefore: null, commaAfter: null };
  // Only the value's own children are scanned, so a comma nested in `tech(features-aat, color-COLRv1)` never splits.
  for (const node of value.children) {
    if (node.type === 'Operator' && node.value === ',') {
      current.commaAfter = spanOf(node);
      groups.push(current);
      current = { nodes: [], commaBefore: spanOf(node), commaAfter: null };
    } else {
      current.nodes.push(node);
    }
  }
  groups.push(current);

  return groups
    .filter((group) => group.nodes.length > 0)
    .map((group) => {
      const url = group.nodes.find((node) => node.type === 'Url');
      return {
        start: group.nodes[0]!.loc!.start.offset,
        end: group.nodes[group.nodes.length - 1]!.loc!.end.offset,
        url: url ? (urlByOffset.get(url.loc!.start.offset) ?? null) : null,
        format: formatKeyword(group.nodes),
        commaBefore: group.commaBefore,
        commaAfter: group.commaAfter,
      };
    });
}

/**
 * Spans to delete to drop `dropped` from a `src:` list, one per run of consecutive sources so a comma shared by two
 * drops is not deleted twice. Empty when every source would go, since an empty `src:` invalidates the whole face.
 */
export function removalSpans(sources: FontSource[], dropped: Set<number>): Span[] {
  if (dropped.size === 0 || dropped.size >= sources.length) {
    return [];
  }
  const spans: Span[] = [];
  for (let i = 0; i < sources.length; i++) {
    if (!dropped.has(i)) {
      continue;
    }
    let last = i;
    while (dropped.has(last + 1)) {
      last++;
    }
    const first = sources[i]!;
    const tail = sources[last]!;
    // A run at the head has no comma before it, and cannot reach the tail while a source survives.
    spans.push(first.commaBefore ? { start: first.commaBefore.start, end: tail.end } : { start: first.start, end: tail.commaAfter!.end });
    i = last;
  }
  return spans;
}

function formatKeyword(nodes: CssNode[]): string | null {
  const fn = nodes.find((n): n is FunctionNode => n.type === 'Function' && n.name.toLowerCase() === 'format');
  const arg = fn ? [...fn.children][0] : undefined;
  if (arg?.type === 'String') {
    return arg.value.toLowerCase();
  }
  // Bun's bundler unquotes format() hints, so the keyword often arrives as a bare identifier.
  return arg?.type === 'Identifier' ? arg.name.toLowerCase() : null;
}
