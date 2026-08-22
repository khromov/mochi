export const SITE_URL = 'https://mochi.fast';
export const STATIC_OG_IMAGE = `${SITE_URL}/og-default.jpg`;

/**
 * Paths the `/og/*` endpoint can find a title for. Kept as plain patterns rather than imported from
 * `og/resolve.ts`, which pulls in the filesystem-backed docs and blog registries and would drag them
 * into the client bundle. `og/ogImage.test.ts` asserts the two stay in agreement.
 */
const DYNAMIC_OG_PATHS = [/^\/$/, /^\/ci$/, /^\/blog$/, /^\/docs\/[^/]+$/, /^\/blog\/[^/]+$/, /^\/demos\/[^/]+$/];

/**
 * The card endpoint mirrors the canonical path, so a page needs to say nothing beyond the `canonical`
 * it already passes. Anything the endpoint can't resolve keeps the static card.
 */
export function ogImageFor(canonical: string | undefined): string {
  if (!canonical) {
    return STATIC_OG_IMAGE;
  }
  const path = new URL(canonical, SITE_URL).pathname.replace(/\/+$/, '') || '/';
  if (!DYNAMIC_OG_PATHS.some((pattern) => pattern.test(path))) {
    return STATIC_OG_IMAGE;
  }
  return `${SITE_URL}/og${path === '/' ? '/index' : path}.jpg`;
}
