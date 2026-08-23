import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { MochiWsConfig, MochiWsData, MochiWsHandlers } from 'mochi-framework';
import { CHAT_MAX_HISTORY_BYTES, CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_MESSAGE_BYTES, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS, createChatRoutes } from './routes';

interface FakeSocket {
  ws: ServerWebSocket<MochiWsData>;
  sent: string[];
  published: string[];
  closed: Array<{ code: number; reason: string }>;
}

function chatHandlers(): MochiWsHandlers {
  return (createChatRoutes()['/ws/chat'] as MochiWsConfig).handlers;
}

function fakeSocket(remoteAddress = '203.0.113.7'): FakeSocket {
  const sent: string[] = [];
  const published: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const ws = {
    data: {
      __mochiRoutePattern: '/ws/chat',
      __mochiOpenedAt: performance.now(),
      __mochiPath: '/ws/chat',
      user: undefined,
    },
    remoteAddress,
    send: (message: string | Buffer) => sent.push(String(message)),
    publish: (_topic: string, message: string | Buffer) => published.push(String(message)),
    close: (code: number, reason: string) => closed.push({ code, reason }),
    subscribe: () => true,
    unsubscribe: () => true,
  } as unknown as ServerWebSocket<MochiWsData>;
  return { ws, sent, published, closed };
}

describe('chat WebSocket resource bounds', () => {
  test('retains and replays only the configured message and byte window', async () => {
    const handlers = chatHandlers();
    for (let i = 0; i < CHAT_MAX_HISTORY_MESSAGES + 20; i++) {
      // A distinct address per sender so the rate limiter never trips during setup.
      await handlers.message(fakeSocket(`198.51.100.${i % 200}`).ws, `${i}:` + 'x'.repeat(900));
    }

    const receiver = fakeSocket();
    await handlers.open?.(receiver.ws);
    expect(receiver.sent.length).toBeLessThanOrEqual(CHAT_MAX_HISTORY_MESSAGES);
    expect(receiver.sent.reduce((total, message) => total + Buffer.byteLength(message), 0)).toBeLessThanOrEqual(CHAT_MAX_HISTORY_BYTES);
    expect(receiver.sent.at(-1)?.startsWith(`${CHAT_MAX_HISTORY_MESSAGES + 19}:`)).toBe(true);
  });

  test('closes a client before publishing an oversized text or binary message', async () => {
    const handlers = chatHandlers();
    for (const message of ['x'.repeat(CHAT_MAX_MESSAGE_BYTES + 1), Buffer.alloc(CHAT_MAX_MESSAGE_BYTES + 1)]) {
      const sender = fakeSocket();
      await handlers.message(sender.ws, message);

      expect(sender.closed).toEqual([{ code: 1009, reason: 'Message too large' }]);
      expect(sender.published).toEqual([]);
    }
  });

  test('rejects binary frames outright rather than decoding them into history', async () => {
    const handlers = chatHandlers();
    const sender = fakeSocket();
    await handlers.message(sender.ws, Buffer.from([0xff, 0xfe]));

    expect(sender.closed).toEqual([{ code: 1003, reason: 'Chat frames must be text' }]);
    expect(sender.published).toEqual([]);
  });

  test('closes a client that exceeds the per-window message rate', async () => {
    const handlers = chatHandlers();
    const sender = fakeSocket();
    for (let i = 0; i <= CHAT_RATE_LIMIT; i++) {
      await handlers.message(sender.ws, String(i));
    }

    expect(sender.published).toHaveLength(CHAT_RATE_LIMIT);
    expect(sender.closed).toEqual([{ code: 1008, reason: 'Message rate exceeded' }]);
  });

  // The counter lives on the address, so dropping the socket and redialling must not hand out a fresh allowance.
  test('keeps the budget across reconnects from the same address', async () => {
    const handlers = chatHandlers();
    let published = 0;
    for (let i = 0; i <= CHAT_RATE_LIMIT; i++) {
      const sender = fakeSocket();
      await handlers.message(sender.ws, String(i));
      published += sender.published.length;
      if (i === CHAT_RATE_LIMIT) {
        expect(sender.closed).toEqual([{ code: 1008, reason: 'Message rate exceeded' }]);
      }
    }

    expect(published).toBe(CHAT_RATE_LIMIT);
  });

  test('lets a different address through and forgets a window once it expires', async () => {
    const handlers = chatHandlers();
    for (let i = 0; i < CHAT_RATE_LIMIT; i++) {
      await handlers.message(fakeSocket().ws, String(i));
    }

    const other = fakeSocket('192.0.2.9');
    await handlers.message(other.ws, 'hello');
    expect(other.closed).toEqual([]);

    const later = fakeSocket();
    Bun.sleepSync(0);
    const realNow = Date.now;
    Date.now = () => realNow() + CHAT_RATE_WINDOW_MS;
    try {
      await handlers.message(later.ws, 'after the window');
    } finally {
      Date.now = realNow;
    }
    expect(later.closed).toEqual([]);
  });
});
