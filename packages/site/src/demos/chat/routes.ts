import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const CHAT_MAX_MESSAGE_BYTES = 4 * 1024;
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

export function createChatRoutes(): Record<string, MochiRouteValue> {
  const history: HistoryEntry[] = [];
  let historyBytes = 0;
  // Keyed by remote address, not by socket: a per-socket counter resets on every reconnect, and each reconnect also
  // replays the history buffer — so dropping and redialling would cost the server more than staying under the limit.
  const windows = new Map<string, RateWindow>();

  function allowMessage(address: string, now: number): boolean {
    for (const [key, window] of windows) {
      if (now - window.startedAt >= CHAT_RATE_WINDOW_MS) {
        windows.delete(key);
      }
    }
    const window = windows.get(address) ?? { messages: 0, startedAt: now };
    windows.set(address, window);
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
      return Mochi.ws({
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
          if (!allowMessage(ws.remoteAddress, Date.now())) {
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
