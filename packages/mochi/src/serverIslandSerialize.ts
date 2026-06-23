/**
 * Serialization for server-island props (the `signed-props` token).
 *
 * Server-island props are server↔server: the server packs + signs them, the
 * client sends the opaque token back, and the server (or the dev debug bar)
 * unpacks. We use msgpackr instead of devalue here because it roughly halves the
 * signed token — see `packages/mochi/REPORT.md` — which directly relieves the URL
 * length limit for large props. Hydratable-island props keep using devalue.
 *
 * `structuredClone: true` reaches devalue parity for Date/Map/Set/undefined/
 * Infinity/NaN/RegExp/BigInt/typed arrays and cyclic & repeated references. The
 * only types it drops are `URL` and `URLSearchParams`, restored below via custom
 * extensions so this path preserves the full devalue type set. Registration is
 * global and idempotent per process; this module is isomorphic so the server
 * packer and the dev debug-bar unpacker agree on the extension ids.
 */
import { Packr, Unpackr, addExtension } from 'msgpackr';

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
