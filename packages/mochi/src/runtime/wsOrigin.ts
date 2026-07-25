import type { MochiWsOriginOptions } from '../types';
import { normalizeHttpOrigin } from './proxy';

export function resolveWsTrustedOrigins(options: MochiWsOriginOptions, label: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const value of options.trustedOrigins ?? []) {
    origins.add(normalizeHttpOrigin(value, `${label}.trustedOrigins`));
  }
  return origins;
}

/**
 * Enforce a browser Origin boundary before a WebSocket upgrade. Browsers attach
 * ambient cookies to the handshake, so accepting a foreign Origin would let a
 * hostile page operate a victim's authenticated socket.
 */
export function wsOriginCheck(request: Request, publicUrl: URL, options: MochiWsOriginOptions, trustedOrigins: ReadonlySet<string>): Response | null {
  if (options.checkOrigin === false) {
    return null;
  }

  const header = request.headers.get('origin');
  if (!header) {
    return options.allowMissingOrigin
      ? null
      : new Response('WebSocket Origin forbidden', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
  }

  let origin: string;
  try {
    origin = normalizeHttpOrigin(header, 'WebSocket Origin header');
  } catch {
    return new Response('WebSocket Origin forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (origin === publicUrl.origin || trustedOrigins.has(origin)) {
    return null;
  }
  return new Response('WebSocket Origin forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
