import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createClientCookies } from './cookies.client';
import { logger } from '../utils/log';

// A browser silently ignores a document.cookie write that would touch an HttpOnly cookie. happy-dom has no HttpOnly
// emulation, so refusal is simulated by dropping writes for one name — what the jar observes is identical either way.
function refuseWritesFor(name: string, existing?: string): () => void {
  const store = new Map<string, string>(existing === undefined ? [] : [[name, existing]]);
  const original = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    set: (raw: string) => {
      const [pair] = raw.split(';');
      const [k, v = ''] = (pair ?? '').split('=');
      if (k?.trim() === name) {
        return;
      }
      store.set(k!.trim(), v);
    },
  });
  return () => {
    delete (document as unknown as Record<string, unknown>).cookie;
    if (original) {
      Object.defineProperty(Document.prototype, 'cookie', original);
    }
  };
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe('client cookie jar warnings', () => {
  test('warns that only a server can set HttpOnly', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    createClientCookies().set('httponly-attempt', 'x', { httpOnly: true });
    expect(warn.mock.calls.flat().join(' ')).toContain('Only a server can set HttpOnly');
    warn.mockRestore();
  });

  test('warns when a write is silently refused, as an HttpOnly collision looks', () => {
    const restore = refuseWritesFor('refused-set');
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    createClientCookies().set('refused-set', 'x');
    expect(warn.mock.calls.flat().join(' ')).toContain('had no effect');
    warn.mockRestore();
    restore();
  });

  test('warns when a delete is silently refused', () => {
    const restore = refuseWritesFor('refused-delete', 'stuck');
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    createClientCookies().delete('refused-delete');
    expect(warn.mock.calls.flat().join(' ')).toContain('had no effect');
    warn.mockRestore();
    restore();
  });

  test('stays quiet when the write lands', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    createClientCookies().set('lands', 'value');
    expect(createClientCookies().get('lands')).toBe('value');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('stays quiet for a write scoped where this document cannot read it back', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    createClientCookies().set('elsewhere', 'value', { path: '/somewhere-else/' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
