const DAY_MS = 24 * 60 * 60 * 1000;

export const CONFIRM_TTL_MS = (Number(process.env.NEWSLETTER_CONFIRM_TTL_DAYS) || 14) * DAY_MS;

export const RESEND_COOLDOWN_MS = Number(process.env.NEWSLETTER_RESEND_COOLDOWN_MS) || 5 * 60 * 1000;

// Comfortably above the signup action's own work plus the queue processor it wakes inline, so latency never says which ran.
export const SIGNUP_RESPONSE_FLOOR_MS = 250;

// A queue job has no request context, so the origin can only come from env.
export const PUBLIC_ORIGIN = process.env.MOCHI_ORIGIN || `http://localhost:${process.env.PORT || 3336}`;

// The token in their query string is the whole authorisation, so analytics must never load on these pages.
export const NEWSLETTER_TOKEN_PATHS = ['/newsletter/confirm', '/newsletter/unsubscribe'];

// The trailing slash matters: the site is `trailingSlash: 'always'`, so a
// slashless link costs the recipient a 308.
export function confirmUrl(token: string): string {
  return `${PUBLIC_ORIGIN}/newsletter/confirm/?token=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(token: string): string {
  return `${PUBLIC_ORIGIN}/newsletter/unsubscribe/?token=${encodeURIComponent(token)}`;
}
