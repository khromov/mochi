/**
 * Serialization for server-island props (the `signed-props` token).
 *
 * Server-island props are server↔server: the server packs and seals them, the client sends the opaque token back, and
 * the server unpacks. msgpackr rather than devalue here because it roughly halves the token, which rides in the
 * `/_mochi/island/…?props=` URL and so is length-limited (`bun run bench:msgpack` reproduces the size table).
 * Hydratable-island props keep using devalue — those ship as an inline JSON block, not a URL.
 *
 * `structuredClone: true` reaches devalue parity for Date/Map/Set/undefined/Infinity/NaN/RegExp/BigInt/typed arrays and
 * cyclic & repeated references. The only types it drops are `URL` and `URLSearchParams`, restored below via custom
 * extensions so this path preserves the full devalue type set. The one remaining divergence is `-0`, which restores
 * as `+0`. Extension registration is global and idempotent per process.
 */
// `msgpackr/pack` is msgpackr's pure-JS entry (it re-exports the unpacker too). The bare `msgpackr` specifier resolves
// under Bun's export condition to `node-index.js`, which `require`s the optional native `msgpackr-extract` accelerator —
// overridden here to a workspace stub, whose symlinked path then makes a second in-process `Bun.build()` (page bundle,
// then island bundle) fail with a spurious EISDIR. Nothing wants the accelerator anyway.
import { Packr, Unpackr, addExtension } from 'msgpackr/pack';

addExtension({ Class: URL, type: 0x40, write: (u: URL) => u.href, read: (s: string) => new URL(s) });
addExtension({ Class: URLSearchParams, type: 0x41, write: (q: URLSearchParams) => q.toString(), read: (s: string) => new URLSearchParams(s) });

const packr = new Packr({ structuredClone: true });
const unpackr = new Unpackr({ structuredClone: true });

export function packServerIslandProps(value: unknown): Uint8Array {
  return packr.pack(value);
}

export function unpackServerIslandProps(bytes: Uint8Array): unknown {
  return unpackr.unpack(bytes);
}
