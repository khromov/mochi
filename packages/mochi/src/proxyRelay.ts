import type { ServerWebSocket } from 'bun';
import type { MochiWsData, MochiWsHandlers } from './types';

// Bun's `ServerWebSocket.send` and the browser `WebSocket.send` accept slightly
// different binary unions (the `Buffer`/`MessageEvent.data` we relay is typed
// `ArrayBufferLike`-backed, which both `send` signatures reject). The relay only
// ever forwards opaque text/binary frames, so cast through this permissive type.
type SendFrame = string | Uint8Array<ArrayBuffer> | ArrayBuffer;

// Headers that describe a single transport hop and must never be forwarded
// across a proxy (RFC 7230 §6.1). `transfer-encoding`/`content-encoding` are
// dropped separately because Bun's `fetch` already decodes the upstream body.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

/**
 * Build the outbound header set for an upstream request: drop hop-by-hop
 * headers, drop `accept-encoding` (Bun's fetch auto-decodes, so a compressed
 * upstream body we can't re-encode would corrupt the stream), and pin `Host` to
 * the upstream so name-based vhosts route correctly.
 */
export function buildUpstreamHeaders(req: Request, upstreamHost: string): Headers {
  const headers = new Headers(req.headers);
  for (const name of HOP_BY_HOP) {
    headers.delete(name);
  }
  headers.delete('accept-encoding');
  headers.set('host', upstreamHost);
  return headers;
}

/**
 * Sanitize headers coming back from the upstream before streaming them to the
 * client: Bun already decoded the body, so a stale `content-encoding` /
 * `transfer-encoding` would make the browser try to decode plain bytes.
 */
export function cleanResponseHeaders(res: Response): Headers {
  const headers = new Headers(res.headers);
  for (const name of HOP_BY_HOP) {
    headers.delete(name);
  }
  headers.delete('content-encoding');
  headers.delete('content-length');
  return headers;
}

/**
 * Clamp a close code to the set a client may legally send (1000, or the
 * application range 3000–4999). Protocol codes like 1006/1011/1015 are reserved
 * and throw if passed to `close()`, so anything outside the legal set collapses
 * to 1000.
 */
export function clampCloseCode(code: number): number {
  if (code === 1000) {
    return 1000;
  }
  if (code >= 3000 && code <= 4999) {
    return code;
  }
  return 1000;
}

function safeClose(ws: ServerWebSocket<MochiWsData>, code: number, reason?: string): void {
  try {
    ws.close(clampCloseCode(code), reason);
  } catch {
    // Socket already closing/closed — nothing to do.
  }
}

/**
 * The relay handlers registered (once) into the framework's `wsHandlersMap` for
 * every `Mochi.proxy()` route. They are stateless across sockets: per-socket
 * state (the upstream `WebSocket`, the pre-open frame buffer) lives on
 * `ws.data.__mochiProxy`, set by the proxy route when it upgrades the socket.
 */
export const proxyWsRelayHandlers: MochiWsHandlers = {
  open(ws) {
    const state = ws.data.__mochiProxy;
    if (!state) {
      safeClose(ws, 1011);
      return;
    }
    const client = new WebSocket(state.upstreamWs);
    client.binaryType = 'arraybuffer';
    state.client = client;

    client.onopen = () => {
      for (const frame of state.buffer) {
        client.send(frame as SendFrame);
      }
      state.buffer = [];
    };
    client.onmessage = (event: MessageEvent) => {
      ws.send(event.data as SendFrame);
    };
    client.onclose = (event: CloseEvent) => {
      safeClose(ws, event.code, event.reason);
    };
    client.onerror = () => {
      safeClose(ws, 1011);
    };
  },
  message(ws, message) {
    const state = ws.data.__mochiProxy;
    if (!state) {
      return;
    }
    const client = state.client;
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(message as SendFrame);
    } else {
      // Upstream not connected yet — buffer until `onopen` flushes.
      state.buffer.push(message);
    }
  },
  close(ws) {
    const client = ws.data.__mochiProxy?.client;
    try {
      client?.close();
    } catch {
      // Already closing/closed.
    }
  },
};
