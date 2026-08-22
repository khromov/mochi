import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const CHAT_MAX_MESSAGE_BYTES = 4 * 1024;
export const CHAT_MAX_HISTORY_MESSAGES = 100;
export const CHAT_MAX_HISTORY_BYTES = 64 * 1024;
export const CHAT_RATE_LIMIT = 20;
export const CHAT_RATE_WINDOW_MS = 10_000;

interface ChatClientState {
  messages: number;
  windowStartedAt: number;
}

interface HistoryEntry {
  text: string;
  bytes: number;
}

export function createChatRoutes(): Record<string, MochiRouteValue> {
  const history: HistoryEntry[] = [];
  let historyBytes = 0;

  return {
    '/demos/chat': Mochi.page('./src/demos/chat/Chat.svelte'),
    '/ws/chat': (() => {
      const TOPIC = 'chat';
      return Mochi.ws<ChatClientState>({
        upgrade() {
          return { messages: 0, windowStartedAt: Date.now() };
        },
        open(ws) {
          ws.subscribe(TOPIC);
          for (const entry of history) {
            ws.send(entry.text);
          }
        },
        message(ws, message) {
          const rawBytes = typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : message.byteLength;
          if (rawBytes > CHAT_MAX_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
          }

          const text = String(message);
          const bytes = Buffer.byteLength(text, 'utf8');
          if (bytes > CHAT_MAX_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
          }

          const now = Date.now();
          const state = ws.data.user;
          if (now - state.windowStartedAt >= CHAT_RATE_WINDOW_MS) {
            state.messages = 0;
            state.windowStartedAt = now;
          }
          if (state.messages >= CHAT_RATE_LIMIT) {
            ws.close(1008, 'Message rate exceeded');
            return;
          }
          state.messages++;

          history.push({ text, bytes });
          historyBytes += bytes;
          while (history.length > CHAT_MAX_HISTORY_MESSAGES || historyBytes > CHAT_MAX_HISTORY_BYTES) {
            historyBytes -= history.shift()!.bytes;
          }
          ws.publish(TOPIC, text);
          ws.send(text);
        },
        close(ws) {
          ws.unsubscribe(TOPIC);
        },
      });
    })(),
  };
}

export const routes = createChatRoutes();
