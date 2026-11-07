import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { consoleLogger } from './consoleLogger';
import { initExtensions } from '../extensions';
import { mochiEvents } from '../events';
import { setLogLevel } from '../utils/log';

// The registry-level tests in extensions.test.ts prove the filter is wired;
// these prove it changes what the console logger actually does — which console
// method a line lands on, and what the line filter sees afterwards.
describe('consoleLogger:level changes where a line is written', () => {
  const calls: Array<{ method: string; text: string }> = [];
  const real = { info: console.info, warn: console.warn, log: console.log, debug: console.debug };

  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, text: args.join(' ') });
    };

  beforeAll(() => {
    // 'debug' is the only level that lets every line through, so a missing line
    // is always the filter's doing and never the level gate's.
    setLogLevel('debug');
    console.info = record('info');
    console.warn = record('warn');
    console.log = record('log');
    console.debug = record('debug');
    consoleLogger();
  });

  afterEach(() => {
    calls.length = 0;
    initExtensions({});
  });

  afterAll(() => {
    Object.assign(console, real);
    setLogLevel('warn');
  });

  const request = (path: string, status = 200) => {
    mochiEvents.emit('request', { requestId: 'rid', kind: 'page', method: 'GET', path, status, duration: 5 });
    return calls.find((c) => c.text.includes(path));
  };

  test('an ordinary request line is written at its default level', () => {
    expect(request('/plain')?.method).toBe('info');
  });

  test('a remapped line is written through the filtered level', () => {
    initExtensions({
      filters: {
        'consoleLogger:level': (level, { path }) => (path === '/quiet' ? 'debug' : level),
      },
    });
    expect(request('/quiet')?.method).toBe('debug');
    expect(request('/plain')?.method).toBe('info');
  });

  test('the filter runs after escalation, so a 5xx can be de-escalated', () => {
    initExtensions({
      filters: {
        'consoleLogger:level': (level, { status }) => (status === 500 ? 'info' : level),
      },
    });
    expect(request('/boom', 500)?.method).toBe('info');
  });

  test('a no-op cache sweep is written at the most verbose level', () => {
    mochiEvents.emit('cache:sweep', { removed: 0, durationMs: 1 });
    expect(calls.find((c) => c.text.includes('nothing expired'))?.method).toBe('debug');
  });

  test('a cache sweep that removed entries is written at info', () => {
    mochiEvents.emit('cache:sweep', { removed: 3, durationMs: 1 });
    expect(calls.find((c) => c.text.includes('expired removed'))?.method).toBe('info');
  });

  test('consoleLogger:line sees the remapped level, not the default', () => {
    let seen: string | undefined;
    initExtensions({
      filters: {
        'consoleLogger:level': () => 'warn',
        'consoleLogger:line': (line, ctx) => {
          seen = ctx.level;
          return line;
        },
      },
    });
    request('/promoted');
    expect(seen).toBe('warn');
  });

  // Queue lifecycle must be visible at the production default level ('warn'),
  // not just under the dev default — see the queue subscribers in consoleLogger.ts.
  describe('queue lifecycle at the production level', () => {
    beforeAll(() => {
      setLogLevel('warn');
    });

    afterAll(() => {
      setLogLevel('debug');
    });

    test('queue:added is written through console.warn', () => {
      mochiEvents.emit('queue:added', { queue: 'emails', jobId: 'j1' });
      const line = calls.find((c) => c.text.includes('emails'));
      expect(line?.method).toBe('warn');
    });

    test('a fast queue:completed still prints, without relying on slow-escalation', () => {
      mochiEvents.emit('queue:completed', { queue: 'emails', jobId: 'j1', attempt: 1, duration: 5 });
      const line = calls.find((c) => c.text.includes('emails'));
      expect(line?.method).toBe('warn');
      expect(line?.text).toContain('done');
    });

    test('queue:active stays debug-gated and prints nothing', () => {
      mochiEvents.emit('queue:active', { queue: 'emails', jobId: 'j1', attempt: 1 });
      expect(calls).toEqual([]);
    });
  });
});
