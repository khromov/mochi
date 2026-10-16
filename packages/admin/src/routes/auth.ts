import { Mochi, fail, redirect } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { DEMO_USER, SESSION_COOKIE, createSession, destroySession } from '../lib/auth.server';

export const routes: Record<string, MochiRouteValue> = {
  '/login': Mochi.page('./src/Login.svelte', {
    serverProps: () => ({
      demoUser: { username: DEMO_USER.username, password: DEMO_USER.password },
    }),
    actions: {
      login: async ({ formData, cookies }) => {
        const username = String(formData.get('username') ?? '').trim();
        const password = String(formData.get('password') ?? '');

        // STUB: a real app looks the user up in the DB and calls
        // verifyPassword(password, user.password_hash). Here we compare against
        // the demo credential directly. See tasks/password-hashing.md.
        if (username !== DEMO_USER.username || password !== DEMO_USER.password) {
          return fail(401, { error: 'Invalid username or password.', username });
        }

        // STUB: createSession returns a placeholder id; nothing is persisted.
        // See tasks/session-store.md.
        const sessionId = createSession({ userId: DEMO_USER.id, username });
        cookies.set(SESSION_COOKIE, sessionId, {
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
          maxAge: 60 * 60 * 8,
        });
        return redirect(303, '/');
      },
      logout: async ({ cookies }) => {
        destroySession(cookies.get(SESSION_COOKIE));
        cookies.delete(SESSION_COOKIE, { path: '/' });
        return redirect(303, '/login/');
      },
    },
  }),
};
