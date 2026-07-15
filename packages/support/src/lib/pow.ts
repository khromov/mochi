// Isomorphic proof-of-work helpers — imported by both the SlideCaptcha island
// (client bundle) and the server-side verifier, so no server-only imports here.

export const CAPTCHA_AAD = 'support-captcha';

export function powInput(token: string, powNonce: string): string {
  return `${token}:${powNonce}`;
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
