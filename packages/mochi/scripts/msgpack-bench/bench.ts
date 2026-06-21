#!/usr/bin/env bun
/**
 * Benchmark: msgpackr vs devalue for serializing Mochi island props.
 *
 *   bun run bench:msgpack              # pretty console tables
 *   bun run bench:msgpack -- --markdown  # emit the full REPORT.md body to stdout
 *
 * The report is regenerated from a real run with:
 *   bun packages/mochi/scripts/msgpack-bench/bench.ts --markdown > packages/mochi/REPORT.md
 *
 * What it measures, per payload: the serialized size of devalue / JSON / msgpackr,
 * the text-encoding ladder needed to embed binary msgpack in an HTML `<script>`
 * (base64 / base85 / base122), and the gzipped ("over the wire") size of each.
 * Every serializer/encoder combo is round-tripped and deep-equal-checked, so only
 * lossless combinations get a size reported.
 */
import { parseArgs } from 'node:util';
import { stringify as devalueStringify, parse as devalueParse } from 'devalue';
import { Packr, Unpackr } from 'msgpackr';
import { encodeBase122, decodeBase122 } from './base122';
import { ALL, REPRESENTATIVE, SPECIAL, type Payload } from './payloads';
import { packServerIslandProps } from '../../src/serverIslandSerialize';

const packr = new Packr({ structuredClone: true });
const unpackr = new Unpackr({ structuredClone: true });

// ---- text encodings for binary payloads --------------------------------------

function encodeBase64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}
function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Adobe Ascii85 (base85). Output includes HTML-unsafe chars (" & < >). */
function encodeBase85(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 4) {
    const block = Math.min(4, n - i);
    let num = 0;
    for (let j = 0; j < 4; j++) {
      num = num * 256 + (j < block ? bytes[i + j]! : 0);
    }
    if (block === 4 && num === 0) {
      out += 'z';
      continue;
    }
    const digits = [0, 0, 0, 0, 0];
    let t = num;
    for (let j = 4; j >= 0; j--) {
      digits[j] = t % 85;
      t = Math.floor(t / 85);
    }
    for (let j = 0; j < block + 1; j++) {
      out += String.fromCharCode(digits[j]! + 33);
    }
  }
  return out;
}
function decodeBase85(str: string): Uint8Array {
  const out: number[] = [];
  let tuple: number[] = [];
  const flush = (count: number) => {
    let num = 0;
    for (let j = 0; j < 5; j++) {
      num = num * 85 + tuple[j]!;
    }
    const b = [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255];
    for (let j = 0; j < count - 1; j++) {
      out.push(b[j]!);
    }
  };
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (ch === 'z' && tuple.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) {
      flush(5);
      tuple = [];
    }
  }
  if (tuple.length > 0) {
    const count = tuple.length;
    while (tuple.length < 5) {
      tuple.push(84);
    }
    flush(count);
  }
  return new Uint8Array(out);
}

const ENCODERS = {
  base64: { encode: encodeBase64, decode: decodeBase64, htmlSafe: true },
  base85: { encode: encodeBase85, decode: decodeBase85, htmlSafe: false },
  base122: { encode: encodeBase122, decode: decodeBase122, htmlSafe: true },
} as const;

// ---- helpers -----------------------------------------------------------------

// Normalize to an ArrayBuffer-backed Uint8Array so types line up across Buffer,
// msgpackr output, and the encoders (all of which default to plain Uint8Array).
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'utf8'));
const gz = (data: Uint8Array<ArrayBuffer>): number => Bun.gzipSync(data).length;

function deepEqual(a: unknown, b: unknown, seen = new Map<unknown, unknown>()): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (typeof a !== 'object' || typeof b !== 'object') {
    if (typeof a === 'number' && Number.isNaN(a) && typeof b === 'number' && Number.isNaN(b)) {
      return true;
    }
    return a === b;
  }
  if (seen.get(a) === b) {
    return true;
  }
  seen.set(a, b);
  // Special-type checks are symmetric: a Map/Set/Date only matches the same kind,
  // so JSON's lossy `Map -> {}` is correctly reported as a mismatch.
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
      return false;
    }
    for (const [k, v] of a) {
      if (!b.has(k) || !deepEqual(v, b.get(k), seen)) {
        return false;
      }
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) {
      return false;
    }
    for (const v of a) {
      if (!b.has(v)) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], seen)) {
        return false;
      }
    }
    return true;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) {
    return false;
  }
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) {
      return false;
    }
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], seen)) {
      return false;
    }
  }
  return true;
}

interface Row {
  label: string;
  /** Bytes embedded in the HTML document (utf8 text), or null if lossy/unsupported. */
  embedded: number | null;
  /** Gzipped size of the embedded bytes, or null. */
  gzipped: number | null;
  htmlSafe: boolean;
  note: string;
}

function measure(payload: Payload): Row[] {
  const rows: Row[] = [];

  const textSer = (label: string, ser: (v: unknown) => string, deser: (s: string) => unknown, note: string) => {
    try {
      const str = ser(payload.value);
      const lossless = deepEqual(deser(str), payload.value);
      const bytes = utf8(str);
      rows.push({ label, embedded: lossless ? bytes.length : null, gzipped: lossless ? gz(bytes) : null, htmlSafe: true, note: lossless ? note : 'lossy round-trip' });
    } catch (err) {
      rows.push({ label, embedded: null, gzipped: null, htmlSafe: true, note: `unsupported (${(err as Error).message.split('\n')[0]})` });
    }
  };

  textSer('devalue (text)', devalueStringify, devalueParse, 'ships as-is in <script>');
  textSer('json (text)', JSON.stringify, (s) => JSON.parse(s), 'baseline, no special types');

  // msgpack: raw binary (the server-island fetch path), then the HTML text ladder.
  let packed: Uint8Array<ArrayBuffer> | null = null;
  try {
    packed = new Uint8Array(packr.pack(payload.value));
    const rt = deepEqual(unpackr.unpack(packed), payload.value);
    rows.push({
      label: 'msgpack raw (binary)',
      embedded: rt ? packed.length : null,
      gzipped: rt ? gz(packed) : null,
      htmlSafe: false,
      note: rt ? 'fetch path only — cannot embed raw in HTML' : 'lossy round-trip',
    });
    if (!rt) {
      packed = null;
    }
  } catch (err) {
    rows.push({ label: 'msgpack raw (binary)', embedded: null, gzipped: null, htmlSafe: false, note: `unsupported (${(err as Error).message.split('\n')[0]})` });
  }

  for (const [name, enc] of Object.entries(ENCODERS)) {
    if (!packed) {
      rows.push({ label: `msgpack+${name}`, embedded: null, gzipped: null, htmlSafe: enc.htmlSafe, note: '—' });
      continue;
    }
    try {
      const str = enc.encode(packed);
      const rtBytes = enc.decode(str);
      const lossless = rtBytes.length === packed.length && rtBytes.every((v, i) => v === packed![i]) && deepEqual(unpackr.unpack(rtBytes), payload.value);
      const bytes = utf8(str);
      rows.push({
        label: `msgpack+${name}`,
        embedded: lossless ? bytes.length : null,
        gzipped: lossless ? gz(bytes) : null,
        htmlSafe: enc.htmlSafe,
        note: lossless ? (enc.htmlSafe ? '' : 'needs HTML escaping (" & < >)') : 'lossy encode',
      });
    } catch (err) {
      rows.push({ label: `msgpack+${name}`, embedded: null, gzipped: null, htmlSafe: enc.htmlSafe, note: `error (${(err as Error).message.split('\n')[0]})` });
    }
  }

  return rows;
}

// ---- rendering ---------------------------------------------------------------

function pct(val: number | null, base: number | null): string {
  if (val == null || base == null || base === 0) {
    return '—';
  }
  const d = ((val - base) / base) * 100;
  const s = d > 0 ? '+' : '';
  return `${s}${d.toFixed(1)}%`;
}

function baseGzip(rows: Row[]): number | null {
  return rows.find((r) => r.label === 'devalue (text)')?.gzipped ?? null;
}

// Model the server-island signed-token length exactly as `serverIslandCrypto.ts`:
// deflate-if-smaller (≥64B, `~` prefix), base64url, plus a 23-char `.`+128-bit sig.
const SIG_CHARS = 23;
function serverIslandTokenLen(bytes: Uint8Array<ArrayBuffer>): number {
  const uncompressed = Buffer.from(bytes).toString('base64url');
  if (bytes.length >= 64) {
    const compressed = '~' + Buffer.from(Bun.deflateSync(bytes)).toString('base64url');
    if (compressed.length < uncompressed.length) {
      return compressed.length + SIG_CHARS;
    }
  }
  return uncompressed.length + SIG_CHARS;
}

function serverIslandTokenMarkdown(): string {
  const lines = ['| payload | devalue token | msgpack token | Δ |', '| --- | ---: | ---: | ---: |'];
  for (const pl of [...REPRESENTATIVE, ...SPECIAL]) {
    const dv = serverIslandTokenLen(utf8(devalueStringify(pl.value)));
    let mp: number | null;
    try {
      mp = serverIslandTokenLen(new Uint8Array(packServerIslandProps(pl.value)));
    } catch {
      mp = null;
    }
    lines.push(`| ${pl.name} | ${dv} | ${mp ?? '—'} | ${pct(mp, dv)} |`);
  }
  return lines.join('\n');
}

function mdTable(payload: Payload, rows: Row[]): string {
  const base = baseGzip(rows);
  const lines: string[] = [];
  lines.push(`| serializer | embedded bytes | gzipped | Δ gzip vs devalue | html-safe | notes |`);
  lines.push(`| --- | ---: | ---: | ---: | :---: | --- |`);
  for (const r of rows) {
    lines.push(`| ${r.label} | ${r.embedded ?? '—'} | ${r.gzipped ?? '—'} | ${pct(r.gzipped, base)} | ${r.htmlSafe ? '✓' : '✗'} | ${r.note} |`);
  }
  return lines.join('\n');
}

function consoleTable(payload: Payload, rows: Row[]): void {
  const base = baseGzip(rows);
  console.log(`\n# ${payload.name} — ${payload.note}`);
  const pad = (s: string, n: number) => s.padEnd(n);
  const padL = (s: string, n: number) => s.padStart(n);
  console.log(pad('serializer', 22) + padL('embedded', 10) + padL('gzip', 8) + padL('Δgzip', 9) + '  safe  notes');
  for (const r of rows) {
    console.log(
      pad(r.label, 22) +
        padL(r.embedded?.toString() ?? '—', 10) +
        padL(r.gzipped?.toString() ?? '—', 8) +
        padL(pct(r.gzipped, base), 9) +
        `  ${r.htmlSafe ? '✓' : '✗'}    ${r.note}`,
    );
  }
}

function correctnessMatrix(): { header: string; rows: string[] } {
  const sers: [string, (v: unknown) => boolean][] = [
    ['devalue', (v) => deepEqual(devalueParse(devalueStringify(v)), v)],
    ['json', (v) => deepEqual(JSON.parse(JSON.stringify(v)), v)],
    ['msgpackr', (v) => deepEqual(unpackr.unpack(new Uint8Array(packr.pack(v))), v)],
  ];
  const rows: string[] = [];
  for (const p of SPECIAL) {
    const cells = sers.map(([, fn]) => {
      try {
        return fn(p.value) ? '✅' : '❌';
      } catch {
        return '❌';
      }
    });
    rows.push(`| ${p.name} (${p.note}) | ${cells.join(' | ')} |`);
  }
  return { header: `| special type | ${sers.map((s) => s[0]).join(' | ')} |`, rows };
}

// ---- report prose (kept here so REPORT.md is fully reproducible) --------------

const PROSE_INTRO = `# msgpackr vs devalue for island props

> **Generated** by \`bun run bench:msgpack -- --markdown\` (source: \`packages/mochi/scripts/msgpack-bench/\`). Re-run to regenerate. _This file previously held the Svelte autofixer report, which is regenerable via the \`/autofixer-report\` skill._

Mochi serializes component props with **devalue** and embeds them in the HTML as
\`<script type="application/json">\` blocks for hydratable islands, and as
HMAC-signed base64url tokens for server islands. This report asks whether
switching props serialization to **msgpackr** yields a meaningful size win.

## Why the inline-HTML answer is not "binary is smaller"

An HTML document is **UTF-8 text on the wire**. You cannot drop raw binary
msgpack into a \`text/html\` response — NUL bytes, a lone \`<\` or \`&\`, and invalid
UTF-8 sequences corrupt the parse. So binary must be re-encoded as text, and that
tax is the whole story:

| encoding | overhead | HTML-safe? |
| --- | --- | --- |
| base64 | +33% | yes |
| base85 (Ascii85) | +25% | no — emits \`" & < >\`, must be escaped (erodes the gain) |
| base122 | ~+14% | yes — purpose-built for UTF-8 embedding |

Non-ASCII can't help: any codepoint ≥ U+0080 costs **≥ 2 UTF-8 bytes**, so you
can't beat ~6–7 bits per transmitted byte while staying HTML-safe. base122 is the
densest practical HTML-embeddable encoding (\`scripts/msgpack-bench/base122.ts\`).

## …and gzip narrows it further

HTTP responses are gzipped in transit. JSON-ish text is highly redundant and
compresses very well; base64/base85 scramble byte alignment and compress poorly.
The decision metric below is therefore the **gzipped** column, and "Δ gzip vs
devalue" is the number that matters.`;

const PROSE_PATHS = `## Two transport paths, two verdicts

- **Hydratable islands** (inline \`<script>\`): text-bound. msgpack must pay the
  encoding tax above, then compete against \`gzip(devalue-text)\`. See the per-payload
  tables — on these payloads the inline path typically **ties or loses** after gzip.
- **Server islands** (signed token in the fetch URL): the props are packed,
  HMAC-signed, deflate-if-smaller, and base64url'd into a query parameter. msgpack's
  compactness roughly **halves the token** (table below), which directly relieves the
  ~1800-char URL-length limit. **This path has been adopted** — see below.

## Correctness caveats

devalue handles \`Date\` / \`Map\` / \`Set\` / \`undefined\` / circular & repeated refs.
Plain msgpack does **not** preserve cyclic or repeated references; the benchmark
and the prototype both use \`new Packr({ structuredClone: true })\` /
\`Unpackr({ structuredClone: true })\` to reach parity. The matrix above is generated
from real round-trips. \`JSON\` is the baseline and is expected to fail most special
types — it is included only for scale.

## Recommendation

1. **Do not switch the inline hydration path to msgpack** unless the per-payload
   gzip deltas below are consistently negative for your real props — base122 closes
   most of base64's gap but rarely beats gzipped devalue text, and it costs a client
   bundle (msgpackr) that devalue-text does not. The inline path stays on devalue
   (an experimental \`Mochi.serve({ islandPropsCodec: 'msgpack' })\` flag exists for A/B).
2. **Adopt msgpack for server-island props** — done; see below.`;

const PROSE_ADOPTED = `## Adopted: server-island props

Server-island props (\`mochi:defer\`) now serialize with **msgpackr** instead of
devalue (\`serverIslandSerialize.ts\` + \`serverIslandCrypto.ts\`). This path is
server↔server — the client only round-trips the opaque signed token — so in
production it adds **zero client-bundle weight** (only the dev debug-bar decoder
loads msgpackr) and carries no client correctness risk. The token rides in the
fetch URL, so the smaller payload directly relieves the ~1800-char URL-length limit.

\`Packr({ structuredClone: true })\` plus custom \`URL\`/\`URLSearchParams\` extensions
reaches full devalue type parity (Date, Map, Set, undefined, Infinity/NaN, RegExp,
BigInt, typed arrays, cyclic & repeated refs, URL, URLSearchParams). The one known
divergence is \`-0\` → \`+0\`. Hydratable-island props are unchanged (still devalue).

Signed-token length (deflate-if-smaller + base64url + 23-char sig), Δ vs devalue:`;

// ---- main --------------------------------------------------------------------

function main(): void {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { markdown: { type: 'boolean', default: false } }, allowPositionals: true });

  if (values.markdown) {
    const out: string[] = [PROSE_INTRO, ''];
    out.push('## Correctness matrix\n');
    const matrix = correctnessMatrix();
    out.push(matrix.header);
    out.push(`| --- | :---: | :---: | :---: |`);
    out.push(...matrix.rows);
    out.push('');
    out.push('## Sizes — representative payloads\n');
    for (const p of REPRESENTATIVE) {
      out.push(`### ${p.name} — ${p.note}\n`);
      out.push(mdTable(p, measure(p)));
      out.push('');
    }
    out.push('## Sizes — special-type payloads\n');
    for (const p of SPECIAL) {
      out.push(`### ${p.name} — ${p.note}\n`);
      out.push(mdTable(p, measure(p)));
      out.push('');
    }
    out.push(PROSE_PATHS);
    out.push('');
    out.push(PROSE_ADOPTED);
    out.push('');
    out.push(serverIslandTokenMarkdown());
    out.push('');
    console.log(out.join('\n'));
    return;
  }

  console.log('msgpackr vs devalue — island props serialization\n(gzip is the over-the-wire metric; Δgzip vs devalue is the decision number)');
  for (const p of ALL) {
    consoleTable(p, measure(p));
  }

  console.log('\n# correctness matrix (special types)');
  const matrix = correctnessMatrix();
  console.log(matrix.header.replace(/\|/g, ' '));
  for (const r of matrix.rows) {
    console.log(r.replace(/\|/g, ' '));
  }
}

main();
