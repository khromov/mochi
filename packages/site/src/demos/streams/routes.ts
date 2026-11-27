import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

// Each clock connection holds a 1s timer on a socket the server never times out, so one client must not be able to open them without limit.
export const MAX_CLOCK_CONNECTIONS = 500;

let sseClocks = 0;

export const routes: Record<string, MochiRouteValue> = {
  '/demos/streams': Mochi.page('./src/demos/streams/Streams.svelte'),
  '/ws/time': (() => {
    const intervals = new Map<object, ReturnType<typeof setInterval>>();
    return Mochi.ws({
      open(ws) {
        if (intervals.size >= MAX_CLOCK_CONNECTIONS) {
          ws.close(1013, 'Too many clock connections');
          return;
        }
        ws.send(new Date().toISOString());
        const interval = setInterval(() => {
          ws.send(new Date().toISOString());
        }, 1000);
        intervals.set(ws, interval);
      },
      message() {},
      close(ws) {
        clearInterval(intervals.get(ws));
        intervals.delete(ws);
      },
    });
  })(),
  '/sse/time': Mochi.sse((stream) => {
    if (sseClocks >= MAX_CLOCK_CONNECTIONS) {
      stream.close();
      return;
    }
    // Counted only after the first send, so a send that throws cannot hold a slot that onClose never frees.
    stream.send(new Date().toISOString());
    sseClocks++;
    const interval = setInterval(() => {
      stream.send(new Date().toISOString());
    }, 1000);
    stream.onClose(() => {
      sseClocks--;
      clearInterval(interval);
    });
  }),
};
