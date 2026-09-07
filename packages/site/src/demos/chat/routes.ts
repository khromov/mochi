import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const CHAT_MAX_MESSAGE_BYTES = 4 * 1024;
// Bun drops a frame past this before `message` runs, so it has to sit above the app limit or the handler's 1009 close is unreachable.
export const CHAT_WS_MAX_PAYLOAD_BYTES = 2 * CHAT_MAX_MESSAGE_BYTES;
export const CHAT_MAX_HISTORY_MESSAGES = 100;
export const CHAT_MAX_HISTORY_BYTES = 64 * 1024;
export const CHAT_RATE_LIMIT = 20;
export const CHAT_RATE_WINDOW_MS = 10_000;

interface RateWindow {
  messages: number;
  startedAt: number;
}

interface HistoryEntry {
  text: string;
  bytes: number;
}

interface ChatSocketData {
  rateKey: string;
}

// Behind a proxy that forwards no client address, a shared key would put every visitor in one bucket and let a single burst disconnect them all.
export function rateKeyFor(address: string | null): string {
  return address ? `ip:${address}` : `socket:${crypto.randomUUID()}`;
}

export function createChatRoutes(): Record<string, MochiRouteValue> {
  const history: HistoryEntry[] = [];
  let historyBytes = 0;
  // Keyed by client address so the allowance survives a reconnect, which would otherwise hand out a fresh budget and replay the history buffer again.
  const windows = new Map<string, RateWindow>();

  function allowMessage(key: string, now: number): boolean {
    for (const [k, window] of windows) {
      if (now - window.startedAt >= CHAT_RATE_WINDOW_MS) {
        windows.delete(k);
      }
    }
    const window = windows.get(key) ?? { messages: 0, startedAt: now };
    windows.set(key, window);
    if (window.messages >= CHAT_RATE_LIMIT) {
      return false;
    }
    window.messages++;
    return true;
  }

  return {
    '/demos/chat': Mochi.page('./src/demos/chat/Chat.svelte'),
    '/ws/chat': (() => {
      const TOPIC = 'chat';
      return Mochi.ws<ChatSocketData>({
        upgrade() {
          return { rateKey: rateKeyFor(getRequestContext().getClientAddress()) };
        },
        open(ws) {
          ws.subscribe(TOPIC);
          for (const entry of history) {
            ws.send(entry.text);
          }
        },
        message(ws, message) {
          const bytes = typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : message.byteLength;
          if (bytes > CHAT_MAX_MESSAGE_BYTES) {
            ws.close(1009, 'Message too large');
            return;
          }
          if (typeof message !== 'string') {
            ws.close(1003, 'Chat frames must be text');
            return;
          }
          if (!allowMessage(ws.data.user.rateKey, Date.now())) {
            ws.close(1008, 'Message rate exceeded');
            return;
          }

          history.push({ text: message, bytes });
          historyBytes += bytes;
          while (history.length > CHAT_MAX_HISTORY_MESSAGES || historyBytes > CHAT_MAX_HISTORY_BYTES) {
            historyBytes -= history.shift()!.bytes;
          }
          ws.publish(TOPIC, message);
          ws.send(message);
        },
        close(ws) {
          ws.unsubscribe(TOPIC);
        },
      });
    })(),
  };
}

export const routes = createChatRoutes();
