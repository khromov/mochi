import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/chat': Mochi.page('./src/demos/chat/Chat.svelte'),
  '/ws/chat': (() => {
    const history: string[] = [];
    const TOPIC = 'chat';
    const MAX_HISTORY = 100;
    const MAX_MESSAGE_LENGTH = 2000;
    return Mochi.ws({
      open(ws) {
        ws.subscribe(TOPIC);
        for (const msg of history) {
          ws.send(msg);
        }
      },
      message(ws, message) {
        const text = String(message).slice(0, MAX_MESSAGE_LENGTH);
        history.push(text);
        if (history.length > MAX_HISTORY) {
          history.shift();
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
