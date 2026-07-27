/**
 * base122 — pack arbitrary bytes into a UTF-8 string that is safe to embed in
 * HTML text/attributes, at ~14% size overhead (vs base64's +33%).
 *
 * Why this beats base64 in an HTML context: an HTML document on the wire is
 * UTF-8 bytes, and you cannot drop raw binary into a text/html response (NUL,
 * lone `<`/`&`, and invalid UTF-8 sequences corrupt the parse). The densest
 * ASCII-only encodings still cost ≥ +23% (base85/base91), and they emit
 * HTML-unsafe chars that must be entity-escaped, eating the gain back. base122
 * instead reads the input 7 bits at a time: a legal 7-bit value ships as one
 * single-byte ASCII char (7 data bits in 8 transmitted bits → +14.3%), and the
 * handful of 7-bit values that map to HTML/UTF-8-illegal bytes are folded into a
 * two-byte UTF-8 char that *also* carries the following 7-bit chunk — so the
 * escape costs nothing extra on average. This is a from-scratch variant of
 * Kevin Albertson's base122 idea (https://blog.kevinalbs.com/base122), adjusted
 * so the illegal set also excludes `<` (so output is safe inside a `<script>`
 * raw-text element without further escaping) and with an unambiguous two-byte
 * codepoint layout verified by the benchmark's round-trip assertions.
 *
 * Two-byte codepoint layout: 0x80 + (tag << 7) + sevenBits, where tag ∈ 0..6
 * selects which illegal byte precedes the carried chunk, and tag === 7 is the
 * "shortened" end-of-stream marker (the char carries only its own 7 data bits).
 * Every two-byte codepoint lands in 0x80..0x47F (always 2 UTF-8 bytes, never
 * colliding with the 0..127 single-byte range).
 */

// null, LF, CR, double-quote, ampersand, backslash, `<` — unsafe in HTML
// text/attributes and/or inside a `<script>` raw-text element.
const ILLEGALS = [0, 10, 13, 34, 38, 92, 60];
const SHORTENED = 7;

export function encodeBase122(bytes: Uint8Array): string {
  // Split the input into MSB-first 7-bit chunks; the final partial chunk is
  // left-aligned (right-padded with zero bits).
  const chunks: number[] = [];
  let acc = 0;
  let nbits = 0;
  let ci = 0;
  for (;;) {
    while (nbits < 7 && ci < bytes.length) {
      acc = (acc << 8) | bytes[ci++]!;
      nbits += 8;
    }
    if (nbits === 0) {
      break;
    }
    if (nbits >= 7) {
      nbits -= 7;
      chunks.push((acc >> nbits) & 0x7f);
    } else {
      chunks.push((acc << (7 - nbits)) & 0x7f);
      nbits = 0;
    }
  }

  let out = '';
  for (let i = 0; i < chunks.length;) {
    const v = chunks[i]!;
    const idx = ILLEGALS.indexOf(v);
    if (idx === -1) {
      out += String.fromCharCode(v);
      i += 1;
    } else if (i + 1 < chunks.length) {
      // Fold the illegal chunk together with the next chunk into one two-byte char.
      out += String.fromCharCode(0x80 + (idx << 7) + chunks[i + 1]!);
      i += 2;
    } else {
      // Illegal value as the final lone chunk → shortened form.
      out += String.fromCharCode(0x80 + (SHORTENED << 7) + v);
      i += 1;
    }
  }
  return out;
}

export function decodeBase122(str: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  const push7 = (v: number) => {
    acc = (acc << 7) | (v & 0x7f);
    nbits += 7;
    while (nbits >= 8) {
      nbits -= 8;
      out.push((acc >> nbits) & 0xff);
    }
  };

  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) {
      push7(c);
    } else {
      const t = c - 0x80;
      const tag = t >> 7;
      const seven = t & 0x7f;
      if (tag !== SHORTENED) {
        push7(ILLEGALS[tag]!);
      }
      push7(seven);
    }
  }
  // Trailing < 8 leftover bits are zero padding from encode; drop them.
  return new Uint8Array(out);
}
