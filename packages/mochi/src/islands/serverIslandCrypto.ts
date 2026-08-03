/**
 * Authenticated encryption for server island props through the shared `payloadCrypto` module, so the token on the wire
 * is opaque ciphertext; the secret key and compression setting come from the Mochi config `Mochi.serve()` initializes.
 * The component name binds as AAD — the one request-identifying part of `/_mochi/island/<componentName>?props=…` —
 * which stops a props token sealed for one component being replayed against another.
 *
 * Props cross this boundary as live values, not a serialized string: `serverIslandSerialize` packs them with msgpackr
 * and the byte-level `payloadCrypto` entry points seal/open the packed bytes directly. Decrypt-before-unpack keeps
 * untrusted bytes away from the deserializer.
 */
import { getMochiConfig } from '../mochiConfig';
import { requestContext } from '../runtime/requestContext';
import { encryptPayloadBytes, decryptPayloadBytes } from './payloadCrypto';
import { packServerIslandProps, unpackServerIslandProps } from './serverIslandSerialize';

// msgpack carries rich types (BigInt, Map, Set) that plain JSON.stringify can't: BigInt throws, Map/Set collapse to
// `{}`. Coerce them to a JSON-safe shape so the debug-bar snapshot renders them instead of silently dropping the island.
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  return value;
}

export function encryptProps(props: unknown, componentName: string): string {
  const { options } = getMochiConfig();
  // Copy out of msgpackr's reused internal buffer before anything else can pack over it.
  const packed = Buffer.from(packServerIslandProps(props));
  const token = encryptPayloadBytes(packed, { aad: componentName, compress: options.compressServerIslandProps ?? true });

  // Encrypted props are opaque on the wire, so the debug bar reads this decoded snapshot instead, keyed by the token
  // the client sees in `signed-props`. Best-effort: failures are ignored so encryption never depends on it.
  try {
    const ctx = requestContext.getStore();
    if (ctx?.debugBarData?.serverProps) {
      ctx.debugBarData.serverProps[token] = JSON.stringify(props, jsonSafeReplacer, 2);
    }
  } catch {
    // Debug recording is best-effort; ignore failures.
  }

  return token;
}

/** Returns the unpacked prop value, or `null` if the token fails to open or unpack. */
export function decryptProps(token: string, componentName: string): unknown {
  const bytes = decryptPayloadBytes(token, { aad: componentName });
  if (bytes === null) {
    return null;
  }
  try {
    return unpackServerIslandProps(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
