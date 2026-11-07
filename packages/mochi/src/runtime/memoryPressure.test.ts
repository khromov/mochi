import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryStorage } from '../cache/cache-storage';
import { mochiEvents } from '../events';
import { installMemoryPressureHandler, removeMemoryPressureHandler, registerPressureResponder, respondToPressure, type PressureResponder } from './memoryPressure';

afterEach(() => {
  removeMemoryPressureHandler();
});

const fill = (store: MemoryStorage, count: number) => {
  for (let i = 0; i < count; i++) {
    store.setItem(`k${i}`, `v${i}`);
  }
};

describe('respondToPressure', () => {
  test("'critical' empties an in-memory store outright", () => {
    const store = new MemoryStorage();
    fill(store, 5);

    const result = respondToPressure('critical');

    expect(store.count()).toBe(0);
    expect(result.removed).toBeGreaterThanOrEqual(5);
    expect(result.level).toBe('critical');
  });

  // The distinction that matters: a warning is the OS asking politely, so live entries must survive it.
  test("'warning' drops only aged-out entries, leaving fresh ones", async () => {
    const store = new MemoryStorage({ maxAge: 10 });
    store.setItem('stale', 1);
    await Bun.sleep(25);
    store.setItem('fresh', 2);

    respondToPressure('warning');

    expect(store.getItem('stale')).toBeNull();
    expect(store.getItem('fresh')).toBe(2);
  });

  // The broadcast lets non-cache subsystems react, so it fires regardless of any responders.
  test("emits 'memory:pressure' with the level for other subsystems", () => {
    const seen: Array<'warning' | 'critical'> = [];
    const listener = (e: { level: 'warning' | 'critical' }) => seen.push(e.level);
    mochiEvents.on('memory:pressure', listener);
    try {
      respondToPressure('critical');
      respondToPressure('warning');
    } finally {
      mochiEvents.off('memory:pressure', listener);
    }
    expect(seen).toEqual(['critical', 'warning']);
  });

  test("'warning' on a store with no maxAge keeps everything (sweep is a no-op there)", () => {
    const store = new MemoryStorage();
    fill(store, 3);

    respondToPressure('warning');

    expect(store.count()).toBe(3);
  });

  test('emits cache:pressure with the level and what it reclaimed', () => {
    const store = new MemoryStorage();
    fill(store, 4);
    const events: unknown[] = [];
    const handler = (payload: unknown) => events.push(payload);
    mochiEvents.on('cache:pressure', handler);

    try {
      respondToPressure('critical');
    } finally {
      mochiEvents.off('cache:pressure', handler);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'critical', caches: expect.any(Number) });
  });

  // One cache throwing must not stop the rest from giving memory back — the whole point is to survive the squeeze.
  test('a responder that throws does not stop the others', () => {
    const exploding: PressureResponder = {
      pressureLabel: 'exploding',
      count: () => 1,
      sweep: () => ({ removed: 0 }),
      clear: () => {
        throw new Error('boom');
      },
    };
    registerPressureResponder(exploding);
    const store = new MemoryStorage();
    fill(store, 2);

    expect(() => respondToPressure('critical')).not.toThrow();
    expect(store.count()).toBe(0);
  });

  // The docs invite user code onto this event, and it runs inside a `process.on` listener — a throw would become an
  // uncaughtException, killing the process at the exact moment the OS was trying not to.
  test('a throwing memory:pressure subscriber neither escapes nor skips the drain', () => {
    const store = new MemoryStorage();
    fill(store, 3);
    const listener = () => {
      throw new Error('subscriber boom');
    };
    mochiEvents.on('memory:pressure', listener);
    try {
      expect(() => respondToPressure('critical')).not.toThrow();
    } finally {
      mochiEvents.off('memory:pressure', listener);
    }
    expect(store.count()).toBe(0);
  });

  test('a throwing cache:pressure subscriber does not escape', () => {
    const listener = () => {
      throw new Error('subscriber boom');
    };
    mochiEvents.on('cache:pressure', listener);
    try {
      expect(() => respondToPressure('warning')).not.toThrow();
    } finally {
      mochiEvents.off('cache:pressure', listener);
    }
  });
});

// Registration is the only prune pass a cache gets on a healthy box, where the OS signal never fires.
describe('registerPressureResponder', () => {
  test('drops collected responders instead of holding their refs forever', async () => {
    const { responders } = (globalThis as unknown as Record<string, { responders: Set<WeakRef<PressureResponder>> }>)['__mochi_pressure_registry__']!;
    const churn = () => {
      for (let i = 0; i < 50; i++) {
        new MemoryStorage();
      }
    };
    churn();
    const grown = responders.size;
    for (let i = 0; i < 5 && responders.size >= grown; i++) {
      Bun.gc(true);
      await Bun.sleep(1);
      registerPressureResponder({ pressureLabel: `anchor-${i}`, count: () => 0, sweep: () => ({ removed: 0 }), clear: () => {} });
    }

    expect(responders.size).toBeLessThan(grown);
  });
});

describe('installMemoryPressureHandler', () => {
  test('registers one process listener however many times it is called', () => {
    const before = process.listenerCount('memoryPressure');
    installMemoryPressureHandler();
    installMemoryPressureHandler();
    installMemoryPressureHandler();

    expect(process.listenerCount('memoryPressure')).toBe(before + 1);
  });

  test('an OS notification drains the caches, and removing the handler stops that', () => {
    const store = new MemoryStorage();
    installMemoryPressureHandler();
    fill(store, 3);

    process.emit('memoryPressure' as never, 'critical' as never);
    expect(store.count()).toBe(0);

    removeMemoryPressureHandler();
    fill(store, 3);
    process.emit('memoryPressure' as never, 'critical' as never);
    expect(store.count()).toBe(3);
  });
});
