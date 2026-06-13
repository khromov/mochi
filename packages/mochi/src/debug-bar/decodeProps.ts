import { parse as devalueParse } from 'devalue';

/**
 * Client-side decoders for the dev debug bar.
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

  let json: string;
  if (payload.startsWith('~')) {
    const compressed = base64urlToBytes(payload.slice(1));
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    json = await new Response(stream).text();
  } else {
    json = new TextDecoder().decode(base64urlToBytes(payload));
  }
  return devalueParse(json) as Record<string, unknown>;
}
