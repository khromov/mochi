const ATTR_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Escape a string for embedding in a double-quoted HTML attribute. The
 * browser's attribute parser decodes these entities on `getAttribute()`, so
 * values round-trip exactly — including payloads that already contain entity
 * sequences like `&quot;`, which a bare `"`-only replace would corrupt.
 *
 * This is the framework's single attribute encoder; zero imports on purpose so
 * both server modules and client-bundled web components can share it.
 */
export function escapeHtmlAttr(value: string): string {
  return value.replace(/[&"<>]/g, (ch) => ATTR_REPLACEMENTS[ch]!);
}
