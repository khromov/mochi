// Isomorphic proof-of-work helpers — imported by both the MochiCaptcha island
// (client bundle) and the server-side verifier, so no server-only imports here.

export const CAPTCHA_AAD = 'mochi-captcha';

// The PoW challenge is the last link of a hash chain the widget advances one
// link per slider step, so the challenge is never present in the page — it
// only exists once the slide progression has actually been run.
export const CAPTCHA_STEPS = 10;

/** How long one uninterrupted brute-force slice may run before yielding to paint. */
export const CAPTCHA_SOLVE_SLICE_MS = 8;

/**
 * Total *active* solve time the widget will spend before giving up and showing
 * an error. Active rather than wall-clock: a backgrounded mobile tab stops
 * scheduling slices entirely, and coming back to a failed captcha you never had
 * a chance to solve is worse than waiting.
 */
export const CAPTCHA_SOLVE_BUDGET_MS = 30_000;

export function chainInput(prev: string, step: number): string {
  return `${prev}:step${step}`;
}

export function powInput(challenge: string, powNonce: string): string {
  return `${challenge}:${powNonce}`;
}

/** Lowercase hex, matching node:crypto's digest('hex') on the server side. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/**
 * SHA-256, synchronous and allocation-free per call.
 *
 * The widget used to hash through `crypto.subtle.digest`, which is async: a
 * 16-bit proof-of-work meant ~65k sequentially-awaited promises, each one a
 * chance for a transient rejection to strand the widget, and slow enough on a
 * phone to be felt. A sync digest turns the hash chain into a plain loop and the
 * solve into an interruptible one — no promise ordering to get wrong, and no
 * secure-context requirement, so the widget also works over plain http.
 *
 * `sha256Bytes` is the only allocating entry point; the chain and the solve go
 * through `sha256Hex` / `sha256LeadingZeroBits`, which read the state words
 * directly. Verified byte-for-byte against `node:crypto` in pow.test.ts.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const encoder = new TextEncoder();

// Scratch state reused across calls: the PoW loop runs this tens of thousands of
// times, where per-call allocation costs more than the compression itself.
const W = new Uint32Array(64);
const H = new Uint32Array(8);
let buf = new Uint8Array(256);
let view = new DataView(buf.buffer);

function ensureCapacity(bytes: number): void {
  if (buf.length < bytes) {
    buf = new Uint8Array(Math.max(bytes, buf.length * 2));
    view = new DataView(buf.buffer);
  }
}

/** Hash `input` into the shared state words `H`. */
function digestInto(input: string): void {
  // UTF-8 is at most 3 bytes per UTF-16 code unit (a surrogate pair is two units
  // and four bytes), so this reservation always fits, and +72 covers the 0x80
  // terminator plus the 8-byte length in the worst-case final block.
  ensureCapacity(input.length * 3 + 72);
  const { written } = encoder.encodeInto(input, buf);
  const total = ((written + 8) >> 6) * 64 + 64;
  // buf is reused, so the padding region carries the previous call's bytes.
  buf.fill(0, written, total);
  buf[written] = 0x80;
  const bitLen = written * 8;
  view.setUint32(total - 8, Math.floor(bitLen / 4294967296));
  view.setUint32(total - 4, bitLen >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < total; offset += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(offset + t * 4);
    }
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15]!;
      const y = W[t - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  H[0] = h0;
  H[1] = h1;
  H[2] = h2;
  H[3] = h3;
  H[4] = h4;
  H[5] = h5;
  H[6] = h6;
  H[7] = h7;
}

export function sha256Bytes(input: string): Uint8Array {
  digestInto(input);
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 4, H[i]!);
  }
  return out;
}

export function sha256Hex(input: string): string {
  digestInto(input);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += H[i]!.toString(16).padStart(8, '0');
  }
  return hex;
}

/** `leadingZeroBits(sha256Bytes(input))` without materialising the digest. */
export function sha256LeadingZeroBits(input: string): number {
  digestInto(input);
  let bits = 0;
  for (let i = 0; i < 8; i++) {
    const word = H[i]!;
    if (word === 0) {
      bits += 32;
      continue;
    }
    return bits + Math.clz32(word);
  }
  return bits;
}

/**
 * Advance the token through the full slide-step chain. The hasher is injected so
 * the server can stay on `node:crypto` while the widget uses the sync one above
 * — the two are cross-checked against each other in pow.test.ts.
 */
export function deriveChain(token: string, hashHex: (input: string) => string = sha256Hex): string {
  let chain = token;
  for (let step = 1; step <= CAPTCHA_STEPS; step++) {
    chain = hashHex(chainInput(chain, step));
  }
  return chain;
}

export type PowSliceResult = { nonce: string } | { next: number };

/**
 * Brute-force nonces for up to `sliceMs`, resuming from `from`. Returns either
 * the solution or the nonce to resume at, so the caller can yield to the browser
 * between slices instead of blocking the main thread for the whole solve.
 */
export function solvePowSlice(challenge: string, bits: number, from: number, sliceMs: number, now: () => number = Date.now): PowSliceResult {
  const deadline = now() + sliceMs;
  let n = from;
  for (;;) {
    // Reading the clock costs more than hashing a ~70-byte input, so only check
    // it once per batch rather than per attempt.
    for (let i = 0; i < 512; i++, n++) {
      if (sha256LeadingZeroBits(powInput(challenge, String(n))) >= bits) {
        return { nonce: String(n) };
      }
    }
    if (now() >= deadline) {
      return { next: n };
    }
  }
}
