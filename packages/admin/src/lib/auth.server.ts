// Auth stubs — password hashing + server-side sessions.
//
// STUB MODULE. These are intentionally unimplemented; they exist to show the
// shape an admin app wires up and to be a drop-in target once the framework
// batteries land. See tasks/password-hashing.md and tasks/session-store.md.
//
// `.server.ts` keeps this out of client bundles (see
// packages/docs/73-server-only-imports.md) — hashing + session lookups must
// never ship to the browser.

import type { Handle } from 'mochi-framework';

export interface SessionData {
  userId: number;
  username: string;
}

/** Cookie name for the (stub) session id. */
export const SESSION_COOKIE = 'mochi_admin_session';

// Demo credential. Real apps look the user up in the database and compare
// against a stored hash.
export const DEMO_USER = { id: 1, username: 'admin', password: 'mochi' } as const;

/**
 * Hash a plaintext password for storage.
 *
 * TODO: implement with `Bun.password.hash(pw)` (argon2id by default). See
 * tasks/password-hashing.md — Bun ships this natively, so no dependency is
 * needed.
 */
export async function hashPassword(_password: string): Promise<string> {
  // TODO: return await Bun.password.hash(_password);
  throw new Error('hashPassword is not implemented — see tasks/password-hashing.md');
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * TODO: implement with `Bun.password.verify(pw, hash)`. Until then, the login
 * action compares against DEMO_USER.password directly (clearly a stub).
 */
export async function verifyPassword(_password: string, _hash: string): Promise<boolean> {
  // TODO: return await Bun.password.verify(_password, _hash);
  throw new Error('verifyPassword is not implemented — see tasks/password-hashing.md');
}

/**
 * Create a server-side session and return the opaque id to store in an
 * HttpOnly cookie.
 *
 * TODO: implement a real session store (tasks/session-store.md): generate a
 * cryptographically-random id, persist `data` keyed by that id in a pluggable
 * backend, and support `regenerate()` / `destroy()`.
 */
export function createSession(_data: SessionData): string {
  // TODO: real store. For now the login action just sets a placeholder cookie.
  return 'stub-session';
}

/**
 * Look up the session for the given cookie id.
 *
 * TODO: read from the session store. Returns null (not signed in) for now.
 */
export function getSession(_sessionId: string | undefined): SessionData | null {
  // TODO: return the persisted SessionData for this id, or null.
  return null;
}

/**
 * Destroy the session (logout).
 *
 * TODO: delete the record from the store.
 */
export function destroySession(_sessionId: string | undefined): void {
  // TODO: remove the record keyed by _sessionId.
}

/**
 * The signed-in user's name, for UI display.
 *
 * TODO: derive from `getSession(cookies.get(SESSION_COOKIE))`. Until the session
 * store lands this returns the demo user so the chrome renders a name.
 */
export function currentUser(): string {
  return DEMO_USER.username;
}

export interface Profile {
  username: string;
  name: string;
  email: string;
  role: string;
  /** ISO date the account was created. */
  joinedAt: string;
}

/**
 * The signed-in user's profile.
 *
 * STUB: a real app reads the session, then the `users` row. Returns fixed demo
 * data for now. See tasks/session-store.md.
 */
export function getProfile(): Profile {
  return {
    username: DEMO_USER.username,
    name: 'Admin User',
    email: 'admin@mochi.example',
    role: 'Administrator',
    joinedAt: '2024-01-15',
  };
}

/**
 * Page-request auth guard, composed via `sequence()` in src/index.ts.
 *
 * STUB: passes everything through so the template stays fully navigable while
 * sessions are unimplemented. The real version redirects unauthenticated page
 * requests to `/login/`. See tasks/session-store.md.
 */
export const authGuard: Handle = async ({ event, resolve }) => {
  // TODO: const session = getSession(getRequestContext().cookies.get(SESSION_COOKIE));
  //       if (!session && isProtectedPage(event)) return Response.redirect('/login/', 303);
  return resolve(event);
};
