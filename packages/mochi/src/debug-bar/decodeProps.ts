import { unpackServerIslandProps } from '../serverIslandSerialize';

/**
 * Client-side decoders for the dev debug bar. Server-island props are packed
 * with msgpackr (see `serverIslandSerialize.ts`); this decoder mirrors the
 * server's `verifyAndDecodeProps` minus the HMAC check (the toolbar only
 * displays props, it doesn't trust them). This pulls msgpackr into the dev-only
 * debug-bar bundle; production island bundles never load it.
 */

/** base64url → bytes. `atob` only speaks standard base64, so translate first. */
function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a server island's `signed-props` token into its props object.
 */
export async function decodeSignedProps(token: string): Promise<Record<string, unknown>> {
  const dot = token.lastIndexOf('.');
  const payload = dot === -1 ? token : token.slice(0, dot);

  let bytes: Uint8Array;
  if (payload.startsWith('~')) {
    const compressed = base64urlToBytes(payload.slice(1));
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    bytes = base64urlToBytes(payload);
  }
  return unpackServerIslandProps(bytes) as Record<string, unknown>;
}
