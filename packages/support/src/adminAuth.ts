import { createHash, timingSafeEqual } from 'node:crypto';
import type { Handle } from 'mochi-framework';

const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="Mochi Support Admin", charset="UTF-8"' };

// Hashing first gives both sides a fixed 32-byte buffer, so timingSafeEqual
// never throws on a length mismatch and the comparison leaks no length either.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

function credentialsMatch(header: string | null): boolean {
  // Read at request time, not module load, so a test can set the env after import.
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  // No password configured means no way in — never fall back to an open panel.
  if (!expectedPassword || !header?.startsWith('Basic ')) {
    return false;
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) {
    return false;
  }
  const user = timingSafeEqual(digest(decoded.slice(0, separator)), digest(expectedUser));
  const password = timingSafeEqual(digest(decoded.slice(separator + 1)), digest(expectedPassword));
  return user && password;
}

/** Gates every /admin request — the GET render and the triage POSTs alike. */
export const adminAuth: Handle = async ({ event, resolve }) => {
  if (event.kind === 'asset' || !event.url.pathname.startsWith('/admin')) {
    return resolve(event);
  }
  if (!credentialsMatch(event.request.headers.get('Authorization'))) {
    return new Response('Unauthorized', { status: 401, headers: CHALLENGE });
  }
  return resolve(event);
};
