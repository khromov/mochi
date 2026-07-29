// Shared by the routes (which mint tokens) and the queue (which mails the links
// they end up in), so the two can't drift on TTL or on how a URL is spelled.

const DAY_MS = 24 * 60 * 60 * 1000;

export const CONFIRM_TTL_MS = (Number(process.env.NEWSLETTER_CONFIRM_TTL_DAYS) || 14) * DAY_MS;

/** How long a pending address has to wait before another confirmation email is sent. */
export const RESEND_COOLDOWN_MS = Number(process.env.NEWSLETTER_RESEND_COOLDOWN_MS) || 5 * 60 * 1000;

// A queue job has no request context, so the public origin can only come from
// env — the same value Mochi.serve() hands to proxy.origin.
export const PUBLIC_ORIGIN = process.env.MOCHI_ORIGIN || `http://localhost:${process.env.PORT || 3336}`;

// The trailing slash is load-bearing: the site is `trailingSlash: 'always'`, so a
// slashless link in an email costs the recipient a 308 before it resolves.
export function confirmUrl(token: string): string {
  return `${PUBLIC_ORIGIN}/newsletter/confirm/?token=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(token: string): string {
  return `${PUBLIC_ORIGIN}/newsletter/unsubscribe/?token=${encodeURIComponent(token)}`;
}
