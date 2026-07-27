import type { MochiFormFail, MochiFormRedirect, MochiFormSuccess } from '../types';

/**
 * Re-render the entry component with `form = { ok: false, ... }` and the given HTTP status, for a form action's validation errors.
 *
 * ```ts
 * if (!username) return fail(400, { error: 'Username required', username });
 * ```
 */
export function fail<T extends Record<string, unknown>>(status: number, data: T): MochiFormFail<T> {
  return { __mochiFormFail: true, status, data };
}

/**
 * Produce an HTTP redirect response after an action runs. Use 303 for the standard POST/Redirect/GET pattern after a successful mutation.
 *
 * ```ts
 * return redirect(303, '/dashboard');
 * ```
 */
export function redirect(status: 301 | 302 | 303 | 307 | 308, location: string): MochiFormRedirect {
  return { __mochiFormRedirect: true, status, location };
}

/**
 * Re-render the entry component with `form = { ok: true, ... }` and HTTP 200, for an action that completes while staying
 * on the page — a search form showing results inline.
 *
 * ```ts
 * return success({ message: 'Saved.' });
 * ```
 */
export function success<T extends Record<string, unknown>>(data?: T): MochiFormSuccess<T> {
  return { __mochiFormSuccess: true, data: (data ?? {}) as T };
}

export function isFormFail(v: unknown): v is MochiFormFail {
  return typeof v === 'object' && v !== null && (v as MochiFormFail).__mochiFormFail === true;
}

export function isFormRedirect(v: unknown): v is MochiFormRedirect {
  return typeof v === 'object' && v !== null && (v as MochiFormRedirect).__mochiFormRedirect === true;
}

export function isFormSuccess(v: unknown): v is MochiFormSuccess {
  return typeof v === 'object' && v !== null && (v as MochiFormSuccess).__mochiFormSuccess === true;
}
