import { describe, expect, test } from 'bun:test';
import { resolveEmailOptions } from './config';

describe('resolveEmailOptions', () => {
  test('defaults to the dev transport in development', () => {
    expect(resolveEmailOptions(undefined, true).transport).toEqual({ type: 'dev' });
    expect(resolveEmailOptions({ from: 'a@b.dev' }, true)).toEqual({ from: 'a@b.dev', transport: { type: 'dev' }, filterPii: false });
    expect(resolveEmailOptions({ from: 'a@b.dev' }, false)).toEqual({ from: 'a@b.dev', transport: { type: 'log' }, filterPii: true });
  });

  test('defaults to the log transport in production', () => {
    expect(resolveEmailOptions(undefined, false).transport).toEqual({ type: 'log' });
    expect(resolveEmailOptions({}, false).transport).toEqual({ type: 'log' });
  });

  test('an explicit transport wins over the environment default', () => {
    const smtp = { type: 'smtp', host: 'smtp.acme.dev' } as const;
    expect(resolveEmailOptions({ transport: smtp }, true).transport).toBe(smtp);
    expect(resolveEmailOptions({ transport: { type: 'log' } }, true).transport).toEqual({ type: 'log' });
  });

  test('filterPii defaults to false in dev and true in prod, and is overridable', () => {
    expect(resolveEmailOptions(undefined, true).filterPii).toBe(false);
    expect(resolveEmailOptions(undefined, false).filterPii).toBe(true);
    expect(resolveEmailOptions({ filterPii: true }, true).filterPii).toBe(true);
    expect(resolveEmailOptions({ filterPii: false }, false).filterPii).toBe(false);
  });
});
