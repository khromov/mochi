/** Strip charset/params and lowercase, e.g. "text/html; charset=utf-8" -> "text/html". */
export function baseContentType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

/**
 * Base media types safe to render inline in a browser tab at our own origin —
 * `text/html` and `image/svg+xml` are excluded since they can execute script
 * even with `nosniff`. Anything outside this set (plus a caller's own
 * `extraInlineSafeTypes`) should be forced to `attachment` disposition.
 */
export const INLINE_SAFE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
