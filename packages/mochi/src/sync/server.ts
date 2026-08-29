import type { Server, ServerWebSocket } from 'bun';
import type { AuthContext, SyncQueryMap } from 'reflectdb';
import { createSyncServer } from 'reflectdb/server';
import type { ImplementOptions, RoomCallback, SyncEvent } from 'reflectdb/server';
import { createBunWsServerTransport } from 'reflectdb/transport/bun-ws';
import { mochiEvents } from '../events';
import { finalizeCookieHeaders } from '../runtime/cookies';
import { requestContext } from '../runtime/requestContext';
import type { RequestContextBuilder } from '../runtime/requestSetup';
import type { MochiWsData, MochiWsHandlers } from '../types';
import type { ResolvedSyncOptions, SyncRuntime } from './config';
import { createSyncStorage } from './storage';
import { mintSyncTicket, verifySyncTicket } from './ticket';

/** Payload carried on the Bun socket's `data.user` for a sync connection. */
export interface MochiSyncWsData {
  id: string;
  req?: Request;
}

function errString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitSyncEvent(event: SyncEvent): void {
  switch (event.type) {
    case 'client_connected':
      mochiEvents.emit('sync:open', { clientId: event.clientId });
      break;
    case 'client_disconnected':
      mochiEvents.emit('sync:close', { clientId: event.clientId });
      break;
    case 'ops_processed':
      mochiEvents.emit('sync:op', { clientId: event.clientId, accepted: event.accepted, rejected: event.rejected });
      break;
    case 'auth_failed':
      mochiEvents.emit('sync:error', { clientId: event.clientId, reason: 'auth_failed', error: errString(event.error) });
      break;
    case 'message_invalid':
      mochiEvents.emit('sync:error', { clientId: event.clientId, reason: 'message_invalid', error: event.error });
      break;
    case 'query_error':
      mochiEvents.emit('sync:error', { clientId: event.clientId, reason: 'query_error', error: errString(event.error) });
      break;
    case 'queue_overflow':
      mochiEvents.emit('sync:error', { clientId: event.clientId, reason: 'queue_overflow' });
      break;
    case 'eager_flush_failed':
      mochiEvents.emit('sync:error', { reason: 'eager_flush_failed', error: errString(event.error) });
      break;
  }
}

/**
 * Boot the reflectdb sync server on a Bun WebSocket transport. When `auth` is configured, reflectdb verifies each
 * connection's bearer token as a Mochi-minted ticket (re-checked per ops batch); otherwise it serves anonymous
 * clients. Table/view/room/rate-limit registrations come straight from the resolved options. On any mid-boot throw,
 * the storage handle is closed before rethrowing so a failed boot leaks nothing.
 */
export async function startSyncRuntime(resolved: ResolvedSyncOptions): Promise<SyncRuntime> {
  const storage = createSyncStorage(resolved.storage);
  try {
    const { transport, websocket } = createBunWsServerTransport();
    const server = createSyncServer<SyncQueryMap>({
      queries: resolved.queries,
      // reflectdb skips query execution entirely when its `db` is falsy (snapshots come back empty, nothing
      // broadcasts). Default to `{}` so queries run even when the app closes over its own store instead of threading
      // a handle — `db` stays genuinely optional.
      db: resolved.db ?? {},
      transport,
      storage: storage.adapter,
      allowAnonymous: !resolved.auth,
      onEvent: emitSyncEvent,
    });

    if (resolved.auth) {
      server.auth(async (req) => {
        const header = req.headers.get('authorization') ?? '';
        const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
        const auth = verifySyncTicket(token);
        if (!auth) {
          throw new Error('invalid or expired sync ticket');
        }
        return auth;
      });
    }

    const tables = resolved.tables as Record<string, ImplementOptions<SyncQueryMap, string, AuthContext, unknown>>;
    for (const [name, impl] of Object.entries(tables)) {
      server.implement(name, impl);
    }

    const views = (resolved.views ?? {}) as Record<string, (ctx: never, db: never) => unknown>;
    for (const [name, fn] of Object.entries(views)) {
      // Cast: with the base (non-generic) SyncQueryMap, reflectdb's `ViewKeys` narrows to `never`, so the typed
      // `view()` rejects a plain string name. The runtime resolves the entry by name and guards the view marker.
      server.view(name as never, fn as never);
    }

    const rooms = (resolved.rooms ?? {}) as Record<string, RoomCallback>;
    for (const [pattern, callback] of Object.entries(rooms)) {
      server.room(pattern, callback);
    }

    if (resolved.rateLimit) {
      server.rateLimit(resolved.rateLimit);
    }

    return {
      server,
      websocket,
      transport,
      auth: resolved.auth,
      ticketTtlMs: resolved.ticketTtlMs,
      close: async () => {
        // server.close() closes the transport; the storage handle is ours to close.
        await server.close();
        await storage.close();
      },
    };
  } catch (err) {
    await storage.close();
    throw err;
  }
}

/** Bun ServerWebSocket subset reflectdb's bun-ws transport reads off each socket. */
interface ReflectSocket {
  data: MochiSyncWsData;
  send(data: string): void;
  close(): void;
  readyState?: number;
  getBufferedAmount?: () => number;
  ping?: (data?: string) => void;
}

/**
 * Bridge reflectdb's Bun WebSocket handlers onto Mochi's WS dispatcher. Mochi's socket carries its bookkeeping on
 * `ws.data` and the sync payload on `ws.data.user`, but reflectdb expects `ws.data.{id,req}` directly — so each socket
 * gets a thin adapter (memoized in a WeakMap) exposing exactly what the transport reads. `send` deliberately forwards
 * without a try/catch: reflectdb's `TransportSendError` contract needs a failed send to reject, not be swallowed.
 */
export function createSyncWsHandlers(runtime: SyncRuntime): MochiWsHandlers<MochiSyncWsData> {
  const websocket = runtime.websocket;
  const adapters = new WeakMap<object, ReflectSocket>();

  function adapterFor(ws: ServerWebSocket<MochiWsData<MochiSyncWsData>>): ReflectSocket {
    let adapter = adapters.get(ws);
    if (!adapter) {
      const user = ws.data.user;
      adapter = {
        data: { id: user.id, req: user.req },
        send: (data: string) => ws.send(data),
        close: () => ws.close(),
        get readyState() {
          return ws.readyState;
        },
        getBufferedAmount: () => ws.getBufferedAmount(),
        ping: (data?: string) => ws.ping(data),
      };
      adapters.set(ws, adapter);
    }
    return adapter;
  }

  return {
    open(ws) {
      websocket.open(adapterFor(ws) as never);
    },
    message(ws, message) {
      websocket.message(adapterFor(ws) as never, message);
    },
    close(ws) {
      websocket.close(adapterFor(ws) as never);
      adapters.delete(ws);
    },
  };
}

/**
 * The token endpoint handler: runs the configured `auth(req)` with full request context, then mints a signed ticket
 * the client presents to reflectdb. POST-only (405 otherwise) and JSON-only (415 otherwise) so it is CSRF-safe by
 * construction. Anonymous when no `auth` is configured. Modeled on Mochi's protection-verify handler.
 */
export function createSyncTokenHandler(
  runtime: SyncRuntime,
  tokenPath: string,
  buildRequestContext: RequestContextBuilder,
): (req: Request, server: Server<undefined>) => Promise<Response> {
  return async (req, server) => {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    const setup = await buildRequestContext(req, server, { kind: 'api', pattern: tokenPath, skipProtection: true });
    if ('earlyResponse' in setup) {
      return setup.earlyResponse;
    }
    const { ctx, start, requestId, url } = setup;

    let response: Response;
    if (!runtime.auth) {
      response = Response.json({ token: 'anonymous', ttlMs: runtime.ticketTtlMs }, { headers: { 'Cache-Control': 'no-store' } });
    } else {
      const authFn = runtime.auth;
      const auth = await requestContext.run(ctx, () => authFn(req));
      if (!auth) {
        response = Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      } else {
        response = Response.json({ token: mintSyncTicket(auth, runtime.ticketTtlMs), ttlMs: runtime.ticketTtlMs }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }

    const final = finalizeCookieHeaders(response, ctx.cookies);
    mochiEvents.emit('request', {
      requestId,
      kind: 'api',
      method: req.method,
      path: url.pathname + url.search,
      status: final.status,
      duration: performance.now() - start,
    });
    return final;
  };
}
