import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost/' });

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { enhance } from './enhance.client';

// `*.isolated.test.ts` runs in its own `bun test` invocation:
// GlobalRegistrator pollutes process globals (document, window, fetch,
// HTMLFormElement…) which could affect server-side tests sharing the same
// worker. Each test below restores `globalThis.fetch` and clears the DOM.

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = '';
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function makeForm(opts: { enctype?: string } = {}): HTMLFormElement {
  const form = document.createElement('form');
  // happy-dom returns `form.method` verbatim instead of normalising to
  // lowercase like a real browser would (HTML spec). Set it lowercase so the
  // framework's `=== 'post'` check matches.
  form.method = 'post';
  form.action = 'http://localhost/test';
  if (opts.enctype) {
    form.enctype = opts.enctype;
  }
  document.body.appendChild(form);
  return form;
}

function dispatchSubmit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

// `typeof fetch` carries `preconnect`; lambda mocks don't. Cast via `unknown`
// so TS lets the simpler signature stand in.
function setFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Invoke the attachment factory and apply it to the form, returning a cleanup
// function. Mirrors how Svelte itself runs the attachment inside an `$effect`.
function attach(form: HTMLFormElement, opts?: Parameters<typeof enhance>[0]): () => void {
  return enhance(opts)(form) ?? (() => {});
}

describe('enhance attachment', () => {
  test('cancel() short-circuits before fetch — no request, no callback, onPending toggles cleanly', async () => {
    const form = makeForm();
    let fetchCalls = 0;
    setFetch(() => {
      fetchCalls++;
      return Promise.resolve(new Response('{}'));
    });

    const pendingValues: boolean[] = [];
    let callbackInvoked = false;
    const settled = deferred();

    const cleanup = attach(form, {
      submit: ({ cancel }) => {
        cancel();
        return () => {
          callbackInvoked = true;
        };
      },
      onPending: (v) => {
        pendingValues.push(v);
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(fetchCalls).toBe(0);
    expect(callbackInvoked).toBe(false);
    expect(pendingValues).toEqual([true, false]);
    cleanup();
  });

  test('controller.abort() during in-flight fetch — result handler skipped, AbortError swallowed, onPending(false) still fires', async () => {
    const form = makeForm();

    let signalAbortedAtReject = false;
    setFetch((_url, init) => {
      const signal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          signalAbortedAtReject = signal.aborted;
          const err = new Error('aborted');
          (err as { name: string }).name = 'AbortError';
          reject(err);
        });
      });
    });

    const pendingValues: boolean[] = [];
    let callbackInvoked = false;
    const settled = deferred();

    const cleanup = attach(form, {
      submit: ({ controller }) => {
        // Abort once the fetch is in-flight (next macrotask).
        setTimeout(() => controller.abort(), 5);
        return () => {
          callbackInvoked = true;
        };
      },
      onPending: (v) => {
        pendingValues.push(v);
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(callbackInvoked).toBe(false);
    expect(signalAbortedAtReject).toBe(true);
    expect(pendingValues).toEqual([true, false]);
    cleanup();
  });

  test('update({ reset: false }) on success skips the default form.reset()', async () => {
    const form = makeForm();
    const input = document.createElement('input');
    input.name = 'name';
    form.appendChild(input);
    input.value = 'unchanged';

    setFetch(() => Promise.resolve(new Response(JSON.stringify({ type: 'success', status: 200 }))));

    const settled = deferred();
    const cleanup = attach(form, {
      submit:
        () =>
        async ({ update }) => {
          await update({ reset: false });
          settled.resolve();
        },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(input.value).toBe('unchanged');
    cleanup();
  });

  test('default fallback resets the form on success', async () => {
    const form = makeForm();
    const input = document.createElement('input');
    input.name = 'name';
    form.appendChild(input);
    input.value = 'will-be-cleared';

    setFetch(() => Promise.resolve(new Response(JSON.stringify({ type: 'success', status: 200 }))));

    const settled = deferred();
    const cleanup = attach(form, {
      onPending: (v) => {
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(input.value).toBe('');
    cleanup();
  });

  test('multipart-without-enctype guard — file input rejects with descriptive error before fetch', async () => {
    const form = makeForm({ enctype: 'application/x-www-form-urlencoded' });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'upload';
    form.appendChild(fileInput);

    const dt = new DataTransfer();
    dt.items.add(new File(['hi'], 'a.txt', { type: 'text/plain' }));
    fileInput.files = dt.files;

    let fetchCalls = 0;
    setFetch(() => {
      fetchCalls++;
      return Promise.resolve(new Response('{}'));
    });

    const cleanup = attach(form);

    // The throw happens inside an async submit handler. happy-dom catches
    // rejected listener promises and dispatches an `ErrorEvent` of type
    // `error` on the window — that's our signal. happy-dom also logs the
    // error to its own console; silence that for clean test output.
    const rejection = deferred<Error>();
    const onError = (event: Event): void => {
      event.preventDefault();
      window.removeEventListener('error', onError);
      const err = (event as Event & { error?: Error }).error;
      rejection.resolve(err ?? new Error((event as Event & { message?: string }).message ?? 'unknown'));
    };
    window.addEventListener('error', onError);
    const originalConsoleError = console.error;
    console.error = (): void => {};

    try {
      dispatchSubmit(form);
      const err = await rejection.promise;

      expect(err.message).toContain('multipart/form-data');
      expect(fetchCalls).toBe(0);
    } finally {
      console.error = originalConsoleError;
      cleanup();
    }
  });

  test('onPending(false) fires in finally even when fetch rejects with TypeError', async () => {
    const form = makeForm();
    setFetch(() => Promise.reject(new TypeError('network down')));

    const pendingValues: boolean[] = [];
    let resultType: string | undefined;
    const settled = deferred();

    const cleanup = attach(form, {
      submit:
        () =>
        ({ result }) => {
          resultType = result.type;
        },
      onPending: (v) => {
        pendingValues.push(v);
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(pendingValues).toEqual([true, false]);
    expect(resultType).toBe('error');
    cleanup();
  });

  test('cleanup removes the listener — submit fires before cleanup, is inert after', async () => {
    const form = makeForm();
    let fetchCalls = 0;
    setFetch(() => {
      fetchCalls++;
      return Promise.resolve(new Response(JSON.stringify({ type: 'success', status: 200 })));
    });

    const firstSettled = deferred();
    const cleanup = attach(form, {
      onPending: (v) => {
        if (!v) {
          firstSettled.resolve();
        }
      },
    });

    // Sanity: without cleanup, the listener fires and fetch is called once.
    dispatchSubmit(form);
    await firstSettled.promise;
    expect(fetchCalls).toBe(1);

    // After cleanup, subsequent submits must not reach fetch.
    cleanup();
    dispatchSubmit(form);
    await Bun.sleep(20);
    expect(fetchCalls).toBe(1);
  });

  test('fetch call shape — URL, method, headers, body match the form', async () => {
    const form = makeForm();
    const username = document.createElement('input');
    username.name = 'username';
    username.value = 'alice';
    form.appendChild(username);
    const password = document.createElement('input');
    password.name = 'password';
    password.value = 'hunter2';
    form.appendChild(password);

    let captured: { url: unknown; init: RequestInit | undefined } | null = null;
    setFetch((url, init) => {
      captured = { url, init };
      return Promise.resolve(new Response(JSON.stringify({ type: 'success', status: 200 })));
    });

    const settled = deferred();
    const cleanup = attach(form, {
      onPending: (v) => {
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    expect(captured).not.toBeNull();
    const { url, init } = captured!;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe('http://localhost/test');
    expect(init?.method).toBe('POST');
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const headers = new Headers(init?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('x-mochi-action')).toBe('true');
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');

    // Body should be URLSearchParams carrying the form fields verbatim.
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = init!.body as URLSearchParams;
    expect(body.get('username')).toBe('alice');
    expect(body.get('password')).toBe('hunter2');

    cleanup();
  });

  test('fetch call shape — multipart leaves Content-Type unset and sends FormData', async () => {
    const form = makeForm({ enctype: 'multipart/form-data' });
    const note = document.createElement('input');
    note.name = 'note';
    note.value = 'hello';
    form.appendChild(note);

    let captured: { init: RequestInit | undefined } | null = null;
    setFetch((_url, init) => {
      captured = { init };
      return Promise.resolve(new Response(JSON.stringify({ type: 'success', status: 200 })));
    });

    const settled = deferred();
    const cleanup = attach(form, {
      onPending: (v) => {
        if (!v) {
          settled.resolve();
        }
      },
    });

    dispatchSubmit(form);
    await settled.promise;

    const headers = new Headers(captured!.init?.headers);
    // Critical: framework must NOT set Content-Type on multipart so fetch can
    // generate the boundary string.
    expect(headers.has('content-type')).toBe(false);
    expect(captured!.init?.body).toBeInstanceOf(FormData);
    expect((captured!.init?.body as FormData).get('note')).toBe('hello');

    cleanup();
  });

  test('non-POST form throws synchronously when the attachment is applied', () => {
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = 'http://localhost/test';
    document.body.appendChild(form);

    expect(() => enhance()(form)).toThrow(/method="POST"/);
  });
});
