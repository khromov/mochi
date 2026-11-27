import { describe, expect, test } from 'bun:test';
import { getRequestContext, renderDetached, requestContext } from './requestContext';
import type { MochiRequestContext } from './requestContext';
import { MochiCookieJar } from './cookies';

function makeCtx(): MochiRequestContext {
  return {
    requestId: 'test',
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    isWarmup: false,
    cookies: new MochiCookieJar(null),
    islandProps: new Map(),
    getClientAddress: () => null,
  };
}

// Mimics svelte/server's render(): a lazy thenable whose work runs in a
// microtask only when awaited — not a Promise, and not run on construction.
function lazyThenable<T>(work: () => T): Promise<T> {
  return {
    // oxlint-disable-next-line no-thenable
    then(resolve: (v: T) => void, reject: (e: unknown) => void) {
      queueMicrotask(() => {
        try {
          resolve(work());
        } catch (e) {
          reject(e);
        }
      });
    },
  } as unknown as Promise<T>;
}

describe('renderDetached', () => {
  test('clears the ambient request context inside fn', async () => {
    const ctx = makeCtx();

    // Sanity: the context is visible right up to the renderDetached boundary.
    const [inside, outside] = await requestContext.run(ctx, async () => {
      const seen = await renderDetached(async () => requestContext.getStore());
      return [seen, requestContext.getStore()];
    });

    expect(inside).toBeUndefined();
    expect(outside).toBe(ctx); // restored after renderDetached resolves
  });

  test('getRequestContext() throws inside a detached render', async () => {
    await expect(requestContext.run(makeCtx(), () => renderDetached(async () => getRequestContext()))).rejects.toThrow(/getRequestContext\(\) called outside of a request/);
  });

  // The wrapper owns the await: even when fn returns a lazy thenable whose work
  // runs later in a microtask (svelte/server's render shape), that deferred work
  // still observes the cleared store. This is the property the inline
  // `exit(async () => await render(...))` shape guaranteed only by convention.
  test('deferred work in a lazy thenable still sees the cleared store', async () => {
    const ctx = makeCtx();

    const seen = await requestContext.run(ctx, () => renderDetached(() => lazyThenable(() => requestContext.getStore())));

    expect(seen).toBeUndefined();
  });
});
