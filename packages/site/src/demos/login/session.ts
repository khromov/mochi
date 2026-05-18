import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMochiConfig } from 'mochi-framework';

const CONTEXT = 'mochi-demo-session';
const DEFAULT_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function sign(data: string): string {
  const { secretKey } = getMochiConfig();
  return createHmac('sha256', secretKey).update(CONTEXT).update(':').update(data).digest().subarray(0, 16).toString('base64url');
}

export interface SessionData {
  username: string;
  exp: number;
}

export function createSessionToken(username: string, maxAgeSec: number = DEFAULT_MAX_AGE_SEC): { token: string; maxAgeSec: number; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = Buffer.from(JSON.stringify({ username, exp })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, maxAgeSec, exp };
}

export function verifySessionToken(token: string | undefined): SessionData | null {
  if (!token) {
    return null;
  }
  const dot = token.lastIndexOf('.');
  if (dot === -1) {
    return null;
  }

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);

  if (sig.length !== expected.length) {
    return null;
  }
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }

  let parsed: SessionData;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed.username !== 'string' || typeof parsed.exp !== 'number') {
    return null;
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return parsed;
}
