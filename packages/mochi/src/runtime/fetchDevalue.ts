import { parse } from 'devalue';

/** Thrown by {@link fetchDevalue} for a non-2xx response, carrying the HTTP status alongside the server's error message. */
export class MochiFetchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MochiFetchError';
    this.status = status;
  }
}

/**
 * Fetch a `Mochi.apiDevalue()` endpoint and parse its devalue payload, so rich values (Date, Map, Set, BigInt) survive
 * the wire. Isomorphic — usable from standalone `clientProps`, hydrated islands, and server code alike.
 */
export async function fetchDevalue<T = unknown>(input: string | URL | Request, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  if (!response.ok) {
    throw new MochiFetchError(response.status, extractErrorMessage(text) ?? `${response.status} ${response.statusText}`.trim());
  }
  return parse(text) as T;
}

// A failed request carries `apiError`'s JSON envelope (`{ error: { message } }`), not a devalue body.
function extractErrorMessage(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    return typeof parsed.error?.message === 'string' ? parsed.error.message : null;
  } catch {
    return null;
  }
}
