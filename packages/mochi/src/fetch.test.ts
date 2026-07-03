import { afterEach, describe, expect, test } from 'bun:test';
import { mochiFetch } from './fetch';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// `typeof fetch` carries `preconnect`; simple lambdas don't. Cast via `unknown`.
function setFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof URL ? input.href : input instanceof Request ? input.url : String(input);
}

describe('mochiFetch', () => {
  test('retries a thrown network error up to `retries`, then rethrows', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.reject(new TypeError('network down'));
    });
    await expect(mochiFetch('http://x.test/', { retries: 2, retryDelay: 1 })).rejects.toThrow('network down');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  test('retries a retryable status and returns the eventual success', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.resolve(new Response(calls < 3 ? 'busy' : 'ok', { status: calls < 3 ? 503 : 200 }));
    });
    const res = await mochiFetch('http://x.test/', { retries: 3, retryDelay: 1 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(calls).toBe(3);
  });

  test('does not retry a non-retryable status — returned as-is', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.resolve(new Response('nope', { status: 404 }));
    });
    const res = await mochiFetch('http://x.test/', { retries: 3, retryDelay: 1 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  test('does not retry POST by default', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.resolve(new Response('busy', { status: 503 }));
    });
    const res = await mochiFetch('http://x.test/', { method: 'POST', retries: 3, retryDelay: 1 });
    expect(res.status).toBe(503);
    expect(calls).toBe(1);
  });

  test('retries POST once opted in via retryMethods', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.resolve(new Response('busy', { status: calls < 2 ? 503 : 200 }));
    });
    const res = await mochiFetch('http://x.test/', { method: 'POST', retryMethods: ['POST'], retries: 3, retryDelay: 1 });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test('per-attempt timeout aborts a slow request', async () => {
    setFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        }),
    );
    await expect(mochiFetch('http://x.test/', { timeout: 10, retries: 0 })).rejects.toThrow();
  });

  test('a caller-triggered abort is surfaced immediately and never retried', async () => {
    let calls = 0;
    const controller = new AbortController();
    setFetch((_input, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const promise = mochiFetch('http://x.test/', { signal: controller.signal, retries: 3, retryDelay: 1 });
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('baseUrl prefixes a relative path; absolute input ignores it', async () => {
    let seen: string | undefined;
    setFetch((input) => {
      seen = urlOf(input);
      return Promise.resolve(new Response('ok'));
    });

    await mochiFetch('/users', { baseUrl: 'https://api.example.com' });
    expect(seen).toBe('https://api.example.com/users');

    await mochiFetch('https://other.test/x', { baseUrl: 'https://api.example.com' });
    expect(seen).toBe('https://other.test/x');
  });

  test('a non-retried response passes through as a standard Response', async () => {
    const body = JSON.stringify({ a: 1 });
    setFetch(() => Promise.resolve(new Response(body, { status: 201, headers: { 'content-type': 'application/json', 'x-custom': 'y' } })));
    const res = await mochiFetch('http://x.test/');
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(201);
    expect(res.headers.get('x-custom')).toBe('y');
    expect(await res.json()).toEqual({ a: 1 });
  });

  test('Retry-After takes precedence over exponential backoff', async () => {
    let calls = 0;
    setFetch(() => {
      calls++;
      return Promise.resolve(new Response('busy', { status: calls < 2 ? 503 : 200, headers: calls < 2 ? { 'retry-after': '0' } : {} }));
    });
    const start = performance.now();
    // A huge retryDelay would make backoff dominate; honoring Retry-After: 0 keeps it near-instant.
    const res = await mochiFetch('http://x.test/', { retries: 3, retryDelay: 100_000 });
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(elapsed).toBeLessThan(1000);
  });
});
