// Test doubles that sit where a Postgres server would, for behaviour PGlite cannot show: how many connections a client
// opens, what it does when the server stops answering, and which database its startup packet asks for.
import type { Socket, TCPSocketListener } from 'bun';

export interface TcpProxy {
  port: number;
  /** Client connections currently open. */
  open(): number;
  /** Client connections accepted since the proxy started. */
  accepted(): number;
  /** While stalled, nothing a client sends reaches the server, so every query hangs. */
  stall(on: boolean): void;
  close(): void;
}

interface ProxyState {
  upstream?: Socket<undefined>;
  queue: Uint8Array[];
  seenData: boolean;
}

const CANCEL_REQUEST = 80877102;

/** Forward TCP connections to `targetPort` on localhost, counting them. */
export function startTcpProxy(targetPort: number): TcpProxy {
  const clients = new Set<Socket<ProxyState>>();
  let accepted = 0;
  let stalled = false;

  const flush = (client: Socket<ProxyState>) => {
    const { upstream, queue } = client.data;
    if (!upstream || stalled) {
      return;
    }
    for (const chunk of queue.splice(0)) {
      upstream.write(chunk);
    }
  };

  const server: TCPSocketListener<ProxyState> = Bun.listen<ProxyState>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(client) {
        client.data = { queue: [], seenData: false };
        clients.add(client);
        accepted++;
        void Bun.connect({
          hostname: '127.0.0.1',
          port: targetPort,
          socket: {
            open(upstream) {
              client.data.upstream = upstream;
              flush(client);
            },
            data(_upstream, chunk) {
              client.write(chunk);
            },
            close() {
              client.end();
            },
            error() {
              client.end();
            },
          },
        }).catch(() => client.end());
      },
      data(client, chunk) {
        // PGlite does not implement cancel requests and its one shared session breaks on them; a real server would
        // stop the statement, here it simply runs to its end.
        if (!client.data.seenData && chunk.length === 16 && Buffer.from(chunk).readInt32BE(4) === CANCEL_REQUEST) {
          client.end();
          return;
        }
        client.data.seenData = true;
        // Copied because Bun reuses the buffer once this callback returns.
        client.data.queue.push(new Uint8Array(chunk));
        flush(client);
      },
      close(client) {
        clients.delete(client);
        client.data.upstream?.end();
      },
      error(client) {
        clients.delete(client);
        client.data.upstream?.end();
      },
    },
  });

  return {
    port: server.port,
    open: () => clients.size,
    accepted: () => accepted,
    stall(on) {
      stalled = on;
      if (!on) {
        for (const client of clients) {
          flush(client);
        }
      }
    },
    close() {
      for (const client of clients) {
        client.end();
      }
      server.stop(true);
    },
  };
}

export interface StartupCapture {
  port: number;
  /** The parameters of every startup packet received (`user`, `database`, …). */
  startups: Record<string, string>[];
  close(): void;
}

const SSL_REQUEST = 80877103;

function fatal(message: string): Uint8Array {
  const fields = Buffer.concat([Buffer.from('SFATAL\0'), Buffer.from('C28000\0'), Buffer.from(`M${message}\0`), Buffer.from([0])]);
  const packet = Buffer.alloc(5 + fields.length);
  packet.write('E', 0);
  packet.writeInt32BE(4 + fields.length, 1);
  fields.copy(packet, 5);
  return packet;
}

/** A server that records each client's startup packet and then refuses the login, so the client fails at once. */
export function startStartupCapture(): StartupCapture {
  const startups: Record<string, string>[] = [];
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket, chunk) {
        const packet = Buffer.from(chunk);
        if (packet.length >= 8 && packet.readInt32BE(4) === SSL_REQUEST) {
          socket.write('N');
          return;
        }
        const parts = packet.subarray(8).toString('utf8').split('\0');
        const params: Record<string, string> = {};
        for (let i = 0; i + 1 < parts.length && parts[i] !== ''; i += 2) {
          params[parts[i]!] = parts[i + 1]!;
        }
        startups.push(params);
        socket.write(fatal('startup captured'));
        socket.end();
      },
    },
  });
  return { port: server.port, startups, close: () => server.stop(true) };
}

/** A server that accepts connections and never answers, like a host behind a firewall that drops packets. */
export function startBlackHole(): { port: number; accepted(): number; close(): void } {
  let accepted = 0;
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open() {
        accepted++;
      },
      data() {},
    },
  });
  return { port: server.port, accepted: () => accepted, close: () => server.stop(true) };
}
