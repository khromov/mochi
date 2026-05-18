import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/chat': Mochi.page('./src/demos/chat/Chat.svelte'),
  '/ws/chat': (() => {
    const history: string[] = [];
    const TOPIC = 'chat';
    return Mochi.ws({
      open(ws) {
        ws.subscribe(TOPIC);
        for (const msg of history) {
          ws.send(msg);
        }
      },
      message(ws, message) {
        const text = String(message);
        history.push(text);
        // send to all subscribers including the sender
        ws.publish(TOPIC, text);
        ws.send(text);
      },
      close(ws) {
        ws.unsubscribe(TOPIC);
      },
    });
  })(),
};
