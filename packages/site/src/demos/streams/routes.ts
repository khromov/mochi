import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import Streams from './Streams.svelte';

export const routes: Record<string, MochiRouteValue> = {
  '/demos/streams': Mochi.page(Streams),
  '/ws/time': (() => {
    const intervals = new WeakMap();
    return Mochi.ws({
      open(ws) {
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
    stream.send(new Date().toISOString());
    const interval = setInterval(() => {
      stream.send(new Date().toISOString());
    }, 1000);
    stream.onClose(() => clearInterval(interval));
  }),
};
