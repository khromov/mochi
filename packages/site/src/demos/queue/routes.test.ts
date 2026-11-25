import { afterEach, expect, test } from 'bun:test';
import { mochiEvents } from 'mochi-framework';
import type { MochiSseConfig, MochiSseStream } from 'mochi-framework';
import { QUEUE_NAME } from './queue.server';
import { MAX_QUEUE_EVENT_STREAMS, routes } from './routes';

interface FakeStream {
  stream: MochiSseStream;
  sent: string[];
  closed: boolean;
  disconnect: () => void;
}

const events = routes['/demos/queue/events'] as MochiSseConfig;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function openStream(): FakeStream {
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
  void events.handler(fake.stream, new Request('http://localhost/demos/queue/events'));
  cleanups.push(fake.disconnect);
  return fake;
}

const listenerCount = () => mochiEvents.all.get('queue:added')?.length ?? 0;

test('closes queue event streams past the cap without subscribing them to the event bus', () => {
  const baseline = listenerCount();
  const held = Array.from({ length: MAX_QUEUE_EVENT_STREAMS }, openStream);
  expect(held.every((s) => !s.closed)).toBe(true);
  expect(listenerCount()).toBe(baseline + MAX_QUEUE_EVENT_STREAMS);

  const rejected = openStream();
  expect(rejected.closed).toBe(true);
  expect(listenerCount()).toBe(baseline + MAX_QUEUE_EVENT_STREAMS);

  mochiEvents.emit('queue:completed', { queue: QUEUE_NAME, jobId: 'job-1', attempt: 1, duration: 1 });
  expect(held.every((s) => s.sent.length === 1)).toBe(true);
  expect(rejected.sent).toEqual([]);

  held[0]!.disconnect();
  expect(listenerCount()).toBe(baseline + MAX_QUEUE_EVENT_STREAMS - 1);
  const replacement = openStream();
  expect(replacement.closed).toBe(false);
  expect(listenerCount()).toBe(baseline + MAX_QUEUE_EVENT_STREAMS);
});
