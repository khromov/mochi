/**
 * Always-shipped: hides the element entirely in production. The dev rule below
 * piggy-backs on `[data-message]` attribute presence, so it harmlessly does
 * nothing in production where stubs omit the attribute.
 */
export const ISLAND_FAILURE_CSS = `
mochi-island-failure { display: none; }
`;

/**
 * Dev-only visible style: small dashed-red placeholder with the component name
 * and error message rendered via a `::before` pseudo-element.
 * `\26A0\A0` = ⚠ + non-breaking space.
 */
export const ISLAND_FAILURE_DEV_CSS = `
mochi-island-failure[data-message] {
  display: inline-block;
  padding: 0.5rem 0.75rem;
  border: 2px dashed #c00;
  background: #fff5f5;
  color: #900;
  font-family: var(--font-mono, monospace);
  font-size: 0.85rem;
  border-radius: 4px;
}
mochi-island-failure[data-message]::before {
  content: '\\26A0\\A0' attr(data-component) ': ' attr(data-message);
}
`;

const ATTR_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (ch) => ATTR_REPLACEMENTS[ch]!);
}

/**
 * Build the `<mochi-island-failure>` stub HTML for a crashed island. Visibility is
 * controlled by `ISLAND_FAILURE_CSS` / `ISLAND_FAILURE_DEV_CSS` above.
 *
 * `message` is conditional rather than passed-as-empty because the CSS selector
 * `mochi-island-failure[data-message]` matches on attribute *presence*, so an empty
 * `data-message=""` would surface a blank failure indicator in production.
 *
 * Lives in its own file (separate from `IslandFailure.ts`) so the server can import
 * it without pulling in the `class extends HTMLElement` declaration that the
 * custom-element registration needs.
 */
export function islandFailureStub(componentName: string, message?: string): string {
  const name = escapeAttr(componentName);
  if (message === undefined) {
    return `<mochi-island-failure data-component="${name}"></mochi-island-failure>`;
  }
  return `<mochi-island-failure data-component="${name}" data-message="${escapeAttr(message)}"></mochi-island-failure>`;
}
