import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import type { MochiWsConfig, MochiWsData, MochiWsHandlers } from 'mochi-framework';
import { CHAT_MAX_HISTORY_BYTES, CHAT_MAX_HISTORY_MESSAGES, CHAT_MAX_MESSAGE_BYTES, CHAT_RATE_LIMIT, createChatRoutes } from './routes';

interface FakeSocket {
  ws: ServerWebSocket<MochiWsData>;
  sent: string[];
  published: string[];
  closed: Array<{ code: number; reason: string }>;
}

async function chatHandlers(): Promise<MochiWsHandlers> {
  const config = createChatRoutes()['/ws/chat'] as MochiWsConfig;
  return config.handlers;
}

async function fakeSocket(handlers: MochiWsHandlers): Promise<FakeSocket> {
  const user = await handlers.upgrade?.(new Request('http://localhost/ws/chat'), {});
  if (user === false) {
    throw new Error('chat upgrade unexpectedly rejected');
  }
  const sent: string[] = [];
  const published: string[] = [];
  const closed: Array<{ code: number; reason: string }> = [];
  const ws = {
    data: {
      __mochiRoutePattern: '/ws/chat',
      __mochiOpenedAt: performance.now(),
      __mochiPath: '/ws/chat',
      user,
    },
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
    const handlers = await chatHandlers();
    for (let i = 0; i < CHAT_MAX_HISTORY_MESSAGES + 20; i++) {
      const sender = await fakeSocket(handlers);
      await handlers.message(sender.ws, `${i}:` + 'x'.repeat(900));
    }

    const receiver = await fakeSocket(handlers);
    await handlers.open?.(receiver.ws);
    expect(receiver.sent.length).toBeLessThanOrEqual(CHAT_MAX_HISTORY_MESSAGES);
    expect(receiver.sent.reduce((total, message) => total + Buffer.byteLength(message), 0)).toBeLessThanOrEqual(CHAT_MAX_HISTORY_BYTES);
    expect(receiver.sent.at(-1)?.startsWith(`${CHAT_MAX_HISTORY_MESSAGES + 19}:`)).toBe(true);
  });

  test('closes a client before publishing an oversized text or binary message', async () => {
    const handlers = await chatHandlers();
    for (const message of ['x'.repeat(CHAT_MAX_MESSAGE_BYTES + 1), Buffer.alloc(CHAT_MAX_MESSAGE_BYTES + 1)]) {
      const sender = await fakeSocket(handlers);
      await handlers.message(sender.ws, message);

      expect(sender.closed).toEqual([{ code: 1009, reason: 'Message too large' }]);
      expect(sender.published).toEqual([]);
    }
  });

  test('closes a client that exceeds the per-window message rate', async () => {
    const handlers = await chatHandlers();
    const sender = await fakeSocket(handlers);
    for (let i = 0; i <= CHAT_RATE_LIMIT; i++) {
      await handlers.message(sender.ws, String(i));
    }

    expect(sender.published).toHaveLength(CHAT_RATE_LIMIT);
    expect(sender.closed).toEqual([{ code: 1008, reason: 'Message rate exceeded' }]);
  });
});
