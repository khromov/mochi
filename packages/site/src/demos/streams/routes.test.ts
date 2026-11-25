import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { MochiSseConfig, MochiSseStream, MochiWsConfig, MochiWsData } from 'mochi-framework';
import { MAX_CLOCK_CONNECTIONS, routes } from './routes';

interface FakeStream {
  stream: MochiSseStream;
  sent: string[];
  closed: boolean;
  disconnect: () => void;
}

interface FakeSocket {
  ws: ServerWebSocket<MochiWsData>;
  sent: string[];
  closed: Array<{ code: number; reason: string }>;
}

const sse = routes['/sse/time'] as MochiSseConfig;
const ws = (routes['/ws/time'] as MochiWsConfig).handlers;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function openSse(): FakeStream {
  const callbacks: Array<() => void> = [];
  const fake: FakeStream = {
    sent: [],
    closed: false,
    stream: {
      send: (data) => fake.sent.push(data),
      close: () => {
        fake.closed = true;
      },
      onClose: (cb) => callbacks.push(cb),
    },
    disconnect: () => {
      for (const cb of callbacks.splice(0)) {
        cb();
      }
    },
  };
  void sse.handler(fake.stream, new Request('http://localhost/sse/time'));
  cleanups.push(fake.disconnect);
  return fake;
}

function openWs(): FakeSocket {
  const fake: FakeSocket = {
    sent: [],
    closed: [],
    ws: {
      send: (message: string) => fake.sent.push(message),
      close: (code: number, reason: string) => fake.closed.push({ code, reason }),
    } as unknown as ServerWebSocket<MochiWsData>,
  };
  void ws.open?.(fake.ws);
  cleanups.push(() => void ws.close?.(fake.ws, 1000, ''));
  return fake;
}

describe('/sse/time connection cap', () => {
  test('closes streams past the cap without starting a timer, and frees a slot on disconnect', () => {
    const held = Array.from({ length: MAX_CLOCK_CONNECTIONS }, openSse);
    expect(held.every((s) => !s.closed && s.sent.length === 1)).toBe(true);

    const rejected = openSse();
    expect(rejected.closed).toBe(true);
    expect(rejected.sent).toEqual([]);

    held[0]!.disconnect();
    const replacement = openSse();
    expect(replacement.closed).toBe(false);
    expect(replacement.sent.length).toBe(1);
  });
});

describe('/ws/time connection cap', () => {
  test('closes sockets past the cap with 1013 without starting a timer, and frees a slot on close', () => {
    const held = Array.from({ length: MAX_CLOCK_CONNECTIONS }, openWs);
    expect(held.every((s) => s.closed.length === 0 && s.sent.length === 1)).toBe(true);

    const rejected = openWs();
    expect(rejected.closed.map((c) => c.code)).toEqual([1013]);
    expect(rejected.sent).toEqual([]);
    void ws.close?.(rejected.ws, 1013, '');

    void ws.close?.(held[0]!.ws, 1000, '');
    const replacement = openWs();
    expect(replacement.closed).toEqual([]);
    expect(replacement.sent.length).toBe(1);
  });
});
