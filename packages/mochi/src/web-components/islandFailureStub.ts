import { escapeHtmlAttr } from '../utils/htmlEscape';

/** Always shipped, hiding the element in production. The dev rule below keys on `[data-message]` presence, which production stubs omit. */
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

/**
 * Build the `<mochi-island-failure>` stub HTML for a crashed island, with visibility controlled by the CSS above.
 * `message` is omitted rather than passed empty, since `mochi-island-failure[data-message]` matches on attribute
 * presence and a `data-message=""` would surface a blank failure indicator in production.
 *
 * It lives apart from `IslandFailure.ts` so the server can import it without the `class extends HTMLElement` declaration
 * that custom-element registration needs.
 */
export function islandFailureStub(componentName: string, message?: string): string {
  const name = escapeHtmlAttr(componentName);
  if (message === undefined) {
    return `<mochi-island-failure data-component="${name}"></mochi-island-failure>`;
  }
  return `<mochi-island-failure data-component="${name}" data-message="${escapeHtmlAttr(message)}"></mochi-island-failure>`;
}
