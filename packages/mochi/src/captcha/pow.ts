// Isomorphic proof-of-work helpers — imported by both the MochiCaptcha island
// (client bundle) and the server-side verifier, so no server-only imports here.

export const CAPTCHA_AAD = 'mochi-captcha';

// The PoW challenge is the last link of a hash chain the widget advances one
// link per slider step, so the challenge is never present in the page — it
// only exists once the slide progression has actually been run.
export const CAPTCHA_STEPS = 10;

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
