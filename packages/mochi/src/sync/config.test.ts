import { describe, expect, test } from 'bun:test';
import { defineSyncQueries, presence, t, view } from 'reflectdb';
import { isValidSyncStorage, resolveSyncOptions, validateSyncOptions } from './config';
import type { MochiSyncOptions } from './types';

type Todo = { id: string; text: string; done: boolean };

const queries = defineSyncQueries({
  todos: { row: t<Todo>() },
});

function baseOptions(overrides: Partial<MochiSyncOptions> = {}): MochiSyncOptions {
  return {
    queries,
    tables: { todos: { query: () => [] } },
    ...overrides,
  } as MochiSyncOptions;
}

describe('isValidSyncStorage', () => {
  test('accepts the three valid shapes', () => {
    expect(isValidSyncStorage('memory')).toBe(true);
    expect(isValidSyncStorage({ sqlite: '.db/sync.sqlite' })).toBe(true);
    expect(isValidSyncStorage({ postgres: 'postgres://localhost/db' })).toBe(true);
  });

  test('rejects empty or malformed shapes', () => {
    expect(isValidSyncStorage({ sqlite: '' })).toBe(false);
    expect(isValidSyncStorage({ postgres: '' })).toBe(false);
    expect(isValidSyncStorage({ sqlite: 'a', postgres: 'b' } as never)).toBe(false);
    expect(isValidSyncStorage({} as never)).toBe(false);
    expect(isValidSyncStorage('disk' as never)).toBe(false);
  });
});

describe('resolveSyncOptions', () => {
  test('fills defaults', () => {
    const resolved = resolveSyncOptions(baseOptions());
    expect(resolved.storage).toBe('memory');
    expect(resolved.ticketTtlMs).toBe(600_000);
    expect(resolved.transport).toBe('ws');
  });

  test('preserves explicit values', () => {
    const resolved = resolveSyncOptions(baseOptions({ storage: { sqlite: '.db/s.sqlite' }, ticketTtlMs: 5000 }));
    expect(resolved.storage).toEqual({ sqlite: '.db/s.sqlite' });
    expect(resolved.ticketTtlMs).toBe(5000);
  });
});

describe('validateSyncOptions', () => {
  test('accepts a valid config', () => {
    expect(() => validateSyncOptions(baseOptions())).not.toThrow();
  });

  test('rejects an empty schema', () => {
    expect(() => validateSyncOptions(baseOptions({ queries: {} as never, tables: {} as never }))).toThrow(/non-empty schema/);
  });

  test('rejects a bad storage shape', () => {
    expect(() => validateSyncOptions(baseOptions({ storage: { sqlite: '' } as never }))).toThrow(/storage/);
  });

  test('rejects an unsupported transport', () => {
    expect(() => validateSyncOptions(baseOptions({ transport: 'sse' as never }))).toThrow(/not supported yet/);
  });

  test('rejects a tables key with no schema entry', () => {
    expect(() => validateSyncOptions(baseOptions({ tables: { todos: { query: () => [] }, ghost: { query: () => [] } } as never }))).toThrow(/no matching entry/);
  });

  test('rejects a missing table implementation', () => {
    const q = defineSyncQueries({ todos: { row: t<Todo>() }, notes: { row: t<Todo>() } });
    expect(() => validateSyncOptions({ queries: q, tables: { todos: { query: () => [] } } } as never)).toThrow(/has no implementation/);
  });

  test('rejects a view() entry implemented under tables', () => {
    const q = defineSyncQueries({ todos: { row: t<Todo>() }, summary: view({ row: t<Todo>() }) });
    expect(() => validateSyncOptions({ queries: q, tables: { todos: { query: () => [] }, summary: { query: () => [] } } } as never)).toThrow(/is a view\(\)/);
  });

  test('rejects a presence() entry implemented under tables', () => {
    const q = defineSyncQueries({ todos: { row: t<Todo>() }, cursors: presence({ state: t<{ x: number }>() }) });
    expect(() => validateSyncOptions({ queries: q, tables: { todos: { query: () => [] }, cursors: { query: () => [] } } } as never)).toThrow(/presence\(\) channel/);
  });

  test('rejects a non-view entry under views', () => {
    expect(() => validateSyncOptions(baseOptions({ views: { todos: () => [] } as never }))).toThrow(/not a view\(\)/);
  });
});
