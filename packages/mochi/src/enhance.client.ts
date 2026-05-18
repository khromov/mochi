import * as devalue from 'devalue';
import type { Attachment } from 'svelte/attachments';
import type { MochiEnhanceOptions, MochiEnhanceResult, MochiFormShape, MochiSubmitFunction } from './types';
import { logger } from './log';

const noop = (): void => {};

/**
 * Decode an `ActionResult` JSON envelope produced by Mochi's enhanced POST flow.
 * Useful when rolling your own `onsubmit` instead of `{@attach enhance(...)}`.
 */
export function deserialize<Success extends MochiFormShape = MochiFormShape, Failure extends MochiFormShape = MochiFormShape>(text: string): MochiEnhanceResult<Success, Failure> {
  const parsed = JSON.parse(text) as MochiEnhanceResult<Success, Failure> & { data?: unknown };
  if (typeof parsed.data === 'string') {
    parsed.data = devalue.parse(parsed.data) as Success | Failure;
  }
  return parsed;
}

/**
 * Shallow-clone a form so attribute-named inputs (e.g. `<input name="action">`)
 * can't shadow real form properties when we read them.
 */
function clone<T extends HTMLElement>(element: T): T {
  return HTMLElement.prototype.cloneNode.call(element) as T;
}

/**
 * Progressive-enhancement attachment for `<form method="POST">`. Returns a
 * Svelte attachment that intercepts the native submit, sends the form data
 * over `fetch` with `Accept: application/json`, and invokes either a
 * user-supplied result callback or a minimal default fallback.
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
 * - `error` → `console.error('[mochi] enhance:', error)`
 *
 * Mochi has no client-side `page.form` store, no `goto`, and no
 * `invalidateAll` — components that need to react to failures should pass a
 * `submit` callback that returns a result handler.
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
      if (result.type === 'error') {
        logger.error('enhance:', result.error);
        return;
      }
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

      // A `<input type="file">` without `enctype="multipart/form-data"` would
      // silently coerce the file to its filename (or empty string) on the wire,
      // which is almost never what the author wanted. Surface it loudly.
      // See https://github.com/sveltejs/kit/issues/9819.
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
