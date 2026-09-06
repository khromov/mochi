/**
 * Dev mode for this app, which is a security boundary rather than a convenience: it widens the newsletter widget's
 * `frame-ancestors` allow-list to localhost and waives the ADMIN_PASSWORD / SMTP_HOST / MOCHI_ORIGIN boot checks.
 * Hosts, CI images and tooling export `NODE_ENV` ambiently, so it takes the deliberate `SUPPORT_DEV` opt-in from our
 * own `dev` script as well — a leaked `NODE_ENV=development` in production then fails closed.
 */
export function isSupportDev(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'development' && env.SUPPORT_DEV === '1';
}
