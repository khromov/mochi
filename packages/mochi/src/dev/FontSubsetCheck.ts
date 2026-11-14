// Dev-only inline script, built by `buildInlineWebComponent` and injected after `window.__mochi_font_subsets`: once the
// fonts have loaded, warn about characters set in a subsetted family that its subset cannot draw. The browser takes
// those from the next font in the stack without a word, and only the cascade knows which text lands in which family.
const faces = window.__mochi_font_subsets ?? {};

function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0]!.trim();
  const quote = first[0];
  return (quote === '"' || quote === "'" ? first.slice(1, -1) : first).toLowerCase();
}

function isWhitespace(ch: string): boolean {
  return ch.trim() === '';
}

function transformed(text: string, textTransform: string): string {
  if (textTransform === 'uppercase') {
    return text.toUpperCase();
  }
  if (textTransform === 'lowercase') {
    return text.toLowerCase();
  }
  if (textTransform !== 'capitalize') {
    return text;
  }
  let out = '';
  let wordStart = true;
  for (const ch of text) {
    const space = isWhitespace(ch);
    out += wordStart && !space ? ch.toUpperCase() : ch;
    wordStart = space;
  }
  return out;
}

function covered(ranges: [number, number][], codepoint: number): boolean {
  return ranges.some(([lo, hi]) => codepoint >= lo && codepoint <= hi);
}

function check(): void {
  const missing = new Map<string, Set<string>>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || element.closest('script, style, noscript, template, #mochi-dev-toolbar')) {
      continue;
    }
    const style = getComputedStyle(element);
    const family = firstFamily(style.fontFamily);
    const ranges = faces[family];
    if (!ranges) {
      continue;
    }
    for (const ch of transformed((node as Text).data, style.textTransform)) {
      if (!isWhitespace(ch) && !covered(ranges, ch.codePointAt(0)!)) {
        const chars = missing.get(family) ?? new Set<string>();
        chars.add(ch);
        missing.set(family, chars);
      }
    }
  }
  for (const [family, chars] of missing) {
    const list = [...chars].map((ch) => JSON.stringify(ch)).join(', ');
    const message = `font subset for "${family}" has no glyph for ${list} — the browser draws them with the fallback font. Add the characters to the import's subset attribute.`;
    if (window.__mochi_warn) {
      window.__mochi_warn(message);
    } else {
      console.warn(`[mochi] ${message}`);
    }
  }
}

function start(): void {
  void (document.fonts ? document.fonts.ready : Promise.resolve()).then(check);
}

if (document.readyState === 'complete') {
  start();
} else {
  addEventListener('load', start, { once: true });
}
