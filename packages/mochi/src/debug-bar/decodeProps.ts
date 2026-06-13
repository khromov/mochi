import { parse as devalueParse } from 'devalue';

/**
 * Client-side decoders for the dev debug bar. The framework no longer ships a
 * separate props channel for the toolbar — these recover the props from what's
 * already in the DOM: the devalue JSON behind a hydratable island's
 * `props-ref`/`props`, or the HMAC-signed token in a server island's
 * `signed-props`. Mirrors the encoding in `serverIslandCrypto.ts` (sans the
 * signature check, which is the server's job — the toolbar only reads).
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
 * Decode a server island's `signed-props` token into its props object. The
 * payload is base64url(devalueJson), or `~base64url(rawDeflate(devalueJson))`
 * when compression won — `Bun.deflateSync` emits a raw deflate stream (no zlib
 * header), so the browser decoder is `deflate-raw`.
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

/** Parse a hydratable island's devalue-serialized props (inline or shared block). */
export function parseHydratableProps(json: string): unknown {
  return devalueParse(json);
}
