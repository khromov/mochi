/**
 * Empirically derive the deflate threshold for `encryptPayloadBytes`.
 *
 * `encryptPayloadBytes` only *attempts* `Bun.deflateSync` when the payload is
 * `>= DEFAULT_COMPRESS_MIN_BYTES` (currently 80, overridable via the
 * `payload:compressMinBytes` filter). The inner "use it only if smaller" check already
 * prevents a larger result from ever being used, so this guard is purely a CPU
 * optimization: the size below which it's not worth calling deflate at all.
 *
 * This script runs realistic image-request and devalue (server-island prop)
 * payloads — the only two callers — through the exact same `Bun.deflateSync`
 * call, finds where compression actually starts to pay off, and suggests a
 * threshold. It does NOT modify the framework; it only reports.
 *
 *   bun packages/mochi/scripts/compression-threshold.ts
 */
import { stringify } from 'devalue';
import { packImageRequest } from '../src/image/imageCodec';
import type { ImageRequest } from '../src/image/types';
import { encryptPayloadBytes, decryptPayloadBytes } from '../src/payloadCrypto';

// --- setup: the crypto fns read globalThis.__mochi_config__ (see payloadCrypto.test.ts) ---
(globalThis as unknown as Record<string, unknown>).__mochi_config__ = {
  options: {},
  secretKey: Buffer.from('compression-threshold-script-key'),
};

type Category = 'image' | 'devalue';
interface Sample {
  category: Category;
  label: string;
  bytes: Uint8Array;
}

function imageReq(over: Partial<ImageRequest> = {}): ImageRequest {
  return { src: 'https://example.com/a.png', size: 'thumbnail', ...over };
}

const CDN = 'https://sta-public.fra1.cdn.digitaloceanspaces.com/mochi';
const SIZES = ['thumbnail', 'hero', 'square', 'grayscale-hero'];

function buildImageSamples(): Sample[] {
  const samples: Sample[] = [];
  const push = (label: string, req: ImageRequest) => samples.push({ category: 'image', label, bytes: packImageRequest(req) });

  // Short / typical real URLs with size names.
  push('short png + thumbnail', imageReq());
  push('short jpeg + hero', imageReq({ src: 'https://example.com/a.png', size: 'hero' }));
  push('demo CDN jpg + hero', imageReq({ src: `${CDN}/mochi-1.jpg`, size: 'hero' }));
  push('demo CDN original', imageReq({ src: `${CDN}/mochi-7.jpg`, size: undefined, original: true }));

  // Progressively longer URLs (more path segments) to bracket the crossover.
  for (const segs of [0, 1, 2, 4, 6, 8, 12, 16, 24, 40]) {
    const src = `https://cdn.example.com/${'assets/photos/'.repeat(segs)}hero-image.jpg`;
    const size = SIZES[segs % SIZES.length]!;
    push(`url +${segs} segs (${size})`, imageReq({ src, size }));
  }
  return samples;
}

function buildDevalueSamples(): Sample[] {
  const samples: Sample[] = [];
  const push = (label: string, value: unknown) => samples.push({ category: 'devalue', label, bytes: Buffer.from(stringify(value), 'utf-8') });

  // Tiny / small realistic island props.
  push('like-button', { initialLikes: 42, islandId: 'mochi-likes-0', isHydratable: true });
  push('visitor name', { name: 'friend', islandId: 'mochi-abc123-0', isHydratable: false });
  push('pokemon stats', {
    stats: [
      { name: 'hp', value: 45 },
      { name: 'attack', value: 49 },
      { name: 'defense', value: 49 },
      { name: 'speed', value: 90 },
    ],
    islandId: 'mochi-stats-1',
  });
  push('rich types', {
    date: new Date('2025-01-15T12:00:00Z'),
    map: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    set: new Set([10, 20, 30]),
    url: new URL('https://mochi.dev/docs?v=5'),
    bytes: new Uint8Array([72, 101, 108, 108, 111]),
  });

  // Pokemon-selector option lists swept across lengths to bracket the crossover.
  const names = [
    'bulbasaur',
    'ivysaur',
    'venusaur',
    'charmander',
    'charmeleon',
    'charizard',
    'squirtle',
    'wartortle',
    'blastoise',
    'caterpie',
    'metapod',
    'butterfree',
    'weedle',
    'kakuna',
    'beedrill',
    'pidgey',
    'pidgeotto',
    'pidgeot',
    'rattata',
    'raticate',
  ];
  for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 40, 80, 151]) {
    const options = Array.from({ length: n }, (_, i) => ({ name: names[i % names.length]! }));
    push(`pokemon options x${n}`, { current: 'pikachu', options, islandId: 'mochi-pokemon-0', isHydratable: true });
  }
  return samples;
}

interface Measured extends Sample {
  raw: number;
  deflated: number;
  delta: number;
  pct: number;
  wins: boolean;
}

function measure(s: Sample): Measured {
  const raw = s.bytes.length;
  const deflated = Bun.deflateSync(Buffer.from(s.bytes)).length;
  const delta = raw - deflated;
  return { ...s, raw, deflated, delta, pct: raw === 0 ? 0 : delta / raw, wins: deflated < raw };
}

const pad = (v: string | number, n: number) => String(v).padStart(n);

function printTable(rows: Measured[]): void {
  console.log('\n  size  cat       deflated   Δbytes    Δ%   win  label');
  console.log('  ' + '─'.repeat(72));
  for (const r of rows) {
    console.log(
      `  ${pad(r.raw, 4)}  ${r.category.padEnd(7)}  ${pad(r.deflated, 6)}    ${pad(r.delta, 5)}  ${pad((r.pct * 100).toFixed(0), 4)}%   ${r.wins ? '✓' : '·'}   ${r.label}`,
    );
  }
}

// Smallest raw size whose payload wins by at least `margin` bytes.
function minWinSize(rows: Measured[], margin: number): number | null {
  const winners = rows.filter((r) => r.delta >= margin).map((r) => r.raw);
  return winners.length ? Math.min(...winners) : null;
}

// Largest raw size that still fails to win by `margin` (a payload this big or
// smaller may not be worth deflating).
function maxLoseSize(rows: Measured[], margin: number): number | null {
  const losers = rows.filter((r) => r.delta < margin).map((r) => r.raw);
  return losers.length ? Math.max(...losers) : null;
}

function summarize(label: string, rows: Measured[]): void {
  const sorted = [...rows].sort((a, b) => a.raw - b.raw);
  console.log(`\n${label}  (${rows.length} payloads, ${rows.filter((r) => r.wins).length} compressible)`);
  for (const margin of [1, 8, 16, 32]) {
    const minWin = minWinSize(sorted, margin);
    console.log(`  • first win by ≥${pad(margin, 2)} B:  ${minWin === null ? 'never' : `${minWin} B`}`);
  }
  const minWin10 = sorted.find((r) => r.pct >= 0.1 && r.wins);
  console.log(`  • first win by ≥10%:    ${minWin10 ? `${minWin10.raw} B` : 'never'}`);
}

function main(): void {
  const image = buildImageSamples().map(measure);
  const devalue = buildDevalueSamples().map(measure);
  const all = [...image, ...devalue].sort((a, b) => a.raw - b.raw);

  console.log('═'.repeat(76));
  console.log('  Compression-threshold analysis for encryptPayloadBytes');
  console.log('  (deflate measured via the same Bun.deflateSync call the function makes)');
  console.log('═'.repeat(76));

  printTable(all);

  summarize('IMAGE payloads (packed binary, low redundancy)', image);
  summarize('DEVALUE payloads (JSON props, repetitive)', devalue);
  summarize('ALL payloads', all);

  // End-to-end sanity: run a few through the real function and round-trip them.
  // (encryptPayloadBytes currently logs DEBUG lines that dump the payload, so keep
  // this to a handful of small/medium samples to avoid a wall of debug output.)
  console.log('\nEnd-to-end token sizes via encryptPayloadBytes (compress on vs off):');
  const midWinner = devalue.filter((r) => r.wins && r.raw < 300).sort((a, b) => b.raw - a.raw)[0]!;
  const reps = [image[0]!, devalue.find((r) => r.wins)!, midWinner];
  for (const r of reps) {
    const on = encryptPayloadBytes(r.bytes, { compress: true });
    const off = encryptPayloadBytes(r.bytes, { compress: false });
    const ok = Buffer.from(decryptPayloadBytes(on)!).equals(Buffer.from(r.bytes));
    console.log(`  ${r.label}: raw ${r.raw} B → token ${off.length} ch (off) / ${on.length} ch (on)  round-trip ${ok ? 'ok' : 'FAIL'}`);
  }

  // Recommendation: set the guard just below the smallest realistic payload that
  // yields a *meaningful* net saving, so nothing worth compressing is skipped
  // while tiny payloads (that can never win) avoid a wasted deflate call. Deflate
  // adds ~11 B of zlib framing, so a few saved bytes is the smallest sensible win.
  const MEANINGFUL = 8;
  const firstMeaningful = minWinSize(all, MEANINGFUL);
  const recommended = firstMeaningful === null ? 64 : firstMeaningful;
  console.log('\n' + '═'.repeat(76));
  console.log('  RECOMMENDATION');
  console.log('═'.repeat(76));
  console.log(`  Current guard:      payload.length >= 80 (DEFAULT_COMPRESS_MIN_BYTES)`);
  console.log(`  Smallest payload that saves ≥${MEANINGFUL} B once deflated: ${firstMeaningful === null ? 'none' : `${firstMeaningful} B`}`);
  console.log(`  Largest payload that still does NOT save ≥${MEANINGFUL} B:    ${maxLoseSize(all, MEANINGFUL) ?? 'n/a'} B`);
  console.log(`\n  → Suggested threshold: payload.length >= ${recommended}`);
  console.log(`    Below ${recommended} B no realistic payload saves a meaningful amount, so the`);
  console.log(`    deflate call is wasted; at/above it, the inner "use only if smaller" check`);
  console.log(`    still drops any low-redundancy payload (e.g. short image URLs) that loses.`);
  console.log('═'.repeat(76));
}

main();
