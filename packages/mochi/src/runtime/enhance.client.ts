import * as devalue from 'devalue';
import type { Attachment } from 'svelte/attachments';
import type { MochiEnhanceOptions, MochiEnhanceResult, MochiFormShape, MochiSubmitFunction } from '../types';
import { logger } from '../utils/log';

const noop = (): void => {};

/** Decode an `ActionResult` JSON envelope from Mochi's enhanced POST flow, for rolling your own `onsubmit` instead of `{@attach enhance(...)}`. */
export function deserialize<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape>(text: string): MochiEnhanceResult<Success, Failure> {
  const parsed = JSON.parse(text) as MochiEnhanceResult<Success, Failure> & { data?: unknown };
  if (typeof parsed.data === 'string') {
    parsed.data = devalue.parse(parsed.data) as Success | Failure;
  }
  return parsed;
}

// Shallow-cloning keeps attribute-named inputs like `<input name="action">` from shadowing real form properties on read.
function clone<T extends HTMLElement>(element: T): T {
  return HTMLElement.prototype.cloneNode.call(element) as T;
}

/**
 * Progressive-enhancement attachment for `<form method="POST">`: it intercepts the native submit, sends the form data
 * over `fetch` with `Accept: application/json`, and invokes a user-supplied result callback or the default fallback.
 *
 * ```svelte
 * <form method="POST" {@attach enhance()}>
 * <form method="POST" {@attach enhance(opts)}>
 * ```
 *
 * Default fallback:
 * - `success` → `form.reset()` (skip with `update({ reset: false })`)
 * - `failure` → no-op (provide a callback to update UI)
 * - `redirect` → `window.location.assign(result.location)`
 * - `error` → logged via `console.error('[mochi] enhance:', error)` before any callback runs, so a
 *   custom handler cannot silently swallow it
 *
 * To react to a failure, pass a `submit` callback returning a result handler — Mochi has no client-side `page.form`
 * store, `goto`, or `invalidateAll`.
 */
export function enhance<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape>(
  options?: MochiSubmitFunction<Success, Failure> | MochiEnhanceOptions<Success, Failure>,
): Attachment<HTMLFormElement> {
  const submit: MochiSubmitFunction<Success, Failure> = typeof options === 'function' ? options : (options?.submit ?? (noop as MochiSubmitFunction<Success, Failure>));
  const onPending = typeof options === 'function' ? undefined : options?.onPending;

  return (formElement) => {
    // `form.method` returns the canonical lowercase keyword per HTML spec.
    if (clone(formElement).method !== 'post') {
      throw new Error('enhance can only be used on <form> elements with method="POST"');
    }

    const fallbackCallback = async ({ action, result, reset = true }: { action: URL; result: MochiEnhanceResult<Success, Failure>; reset?: boolean }): Promise<void> => {
      if (result.type === 'success') {
        if (reset) {
          HTMLFormElement.prototype.reset.call(formElement);
        }
        return;
      }
      if (result.type === 'redirect') {
        window.location.assign(result.location);
        return;
      }
      // error: already logged in handleSubmit before any callback dispatch.
      // failure: no-op by default. The user can subscribe via the submit callback.
      void action;
    };

    async function handleSubmit(event: SubmitEvent): Promise<void> {
      const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
      // One clone covers method/action/enctype reads — saves a couple of
      // allocations per submit and keeps the shadowing-defense in one place.
      const formClone = clone(formElement);
      const method = submitter?.hasAttribute('formmethod') ? submitter.formMethod : formClone.method;
      if (method !== 'post') {
        return;
      }

      event.preventDefault();

      const action = new URL(submitter?.hasAttribute('formaction') ? submitter.formAction : formClone.action);
      const enctype = submitter?.hasAttribute('formenctype') ? submitter.formEnctype : formClone.enctype;
      const formData = new FormData(formElement, submitter);

      // An `<input type="file">` without `enctype="multipart/form-data"` silently coerces the file to its filename, or
      // an empty string, on the wire. See https://github.com/sveltejs/kit/issues/9819.
      if (enctype !== 'multipart/form-data') {
        for (const value of formData.values()) {
          if (typeof value !== 'string') {
            throw new Error('Form contains <input type="file"> but is missing enctype="multipart/form-data". Native and enhanced submissions would behave differently.');
          }
        }
      }

      const controller = new AbortController();

      let cancelled = false;
      const cancel = (): void => {
        cancelled = true;
      };

      onPending?.(true);
      try {
        const userCallback = await submit({
          action,
          cancel,
          controller,
          formData,
          formElement,
          submitter: event.submitter,
        });
        if (cancelled) {
          return;
        }

        const callback = userCallback ?? fallbackCallback;

        let result: MochiEnhanceResult<Success, Failure>;
        try {
          const headers = new Headers({
            accept: 'application/json',
            'x-mochi-action': 'true',
          });
          // For multipart, leave Content-Type unset so fetch can generate the full
          // `multipart/form-data; boundary=...` header — setting it ourselves would
          // drop the boundary and the server couldn't parse the body.
          if (enctype !== 'multipart/form-data') {
            headers.set('Content-Type', enctype === 'text/plain' ? 'text/plain' : 'application/x-www-form-urlencoded');
          }
          // `URLSearchParams` accepts `FormData` at runtime via its iterable
          // interface, but lib.dom.d.ts only types `string | string[][] |
          // Record<string,string> | URLSearchParams`. See
          // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams/URLSearchParams.
          // @ts-expect-error - FormData is iterable and accepted at runtime
          const body: BodyInit = enctype === 'multipart/form-data' ? formData : new URLSearchParams(formData);

          const response = await fetch(action, {
            method: 'POST',
            headers,
            cache: 'no-store',
            body,
            signal: controller.signal,
          });
          result = deserialize<Success, Failure>(await response.text());
          if (result.type === 'error') {
            result.status = response.status;
          }
        } catch (err: unknown) {
          if ((err as { name?: string } | null)?.name === 'AbortError') {
            return;
          }
          result = { type: 'error', error: err };
        }

        // Logged before the callback dispatch so a custom handler that only branches on
        // success/failure can't turn a transport or server error into a silent no-op.
        if (result.type === 'error') {
          logger.error('enhance:', result.error);
        }

        await callback({
          action,
          formData,
          formElement,
          update: (opts?: { reset?: boolean }) => fallbackCallback({ action, result, reset: opts?.reset }),
          result,
        });
      } finally {
        onPending?.(false);
      }
    }

    HTMLFormElement.prototype.addEventListener.call(formElement, 'submit', handleSubmit as unknown as EventListener);

    return () => {
      HTMLFormElement.prototype.removeEventListener.call(formElement, 'submit', handleSubmit as unknown as EventListener);
    };
  };
}
