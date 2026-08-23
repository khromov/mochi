import type { MochiFormFail, MochiRedirect, MochiRedirectInit, MochiFormSuccess } from '../types';

/**
 * Re-render the entry component with `form = { ok: false, action, status, data }` and the given HTTP status, for a form action's validation errors.
 *
 * ```ts
 * if (!username) return fail(400, { error: 'Username required', username });
 * ```
 */
export function fail<T extends Record<string, unknown>>(status: number, data: T): MochiFormFail<T> {
  return { __mochiFormFail: true, status, data };
}

/**
 * Produce an HTTP redirect response from a form action or a `serverProps` resolver. Use 303 for the standard POST/Redirect/GET pattern after a successful mutation.
 *
 * Off-origin destinations are blocked by the redirect guard. Waive it for a single call with `{ external: true }` — for a
 * location your own code builds, never one echoed from request data.
 *
 * ```ts
 * return redirect(303, '/dashboard');
 * return redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { external: true });
 * ```
 */
export function redirect(status: 301 | 302 | 303 | 307 | 308, location: string, init?: MochiRedirectInit): MochiRedirect {
  return init?.external ? { __mochiRedirect: true, status, location, external: true } : { __mochiRedirect: true, status, location };
}

/**
 * Re-render the entry component with `form = { ok: true, action, data }` and HTTP 200, for an action that completes while staying
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

export function isRedirect(v: unknown): v is MochiRedirect {
  return typeof v === 'object' && v !== null && (v as MochiRedirect).__mochiRedirect === true;
}

export function isFormSuccess(v: unknown): v is MochiFormSuccess {
  return typeof v === 'object' && v !== null && (v as MochiFormSuccess).__mochiFormSuccess === true;
}
