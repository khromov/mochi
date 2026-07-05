import type { ComponentRegistry } from '../ComponentRegistry';
import { EmailError } from './types';

/**
 * Render a Svelte component to a standalone HTML email body: SSR-render through
 * the existing registry (no page shell, no hydration/client JS), collect the
 * component's scoped CSS, then inline it into `style=""` attributes with
 * `@css-inline/css-inline` for email-client compatibility. Media queries and
 * pseudo-classes that can't be inlined are preserved in a `<style>` block
 * (`keepStyleTags: true`).
 *
 * Runs outside an HTTP request when called from a background job, so email
 * templates must not touch request-context APIs (`getRequestContext`,
 * `cookies`, `url`). Called from within a route action, the request context is
 * already active.
 *
 * Any `<script>` in the rendered markup is stripped: email clients block
 * scripts outright, so they only bloat the message and trip spam heuristics.
 */
export async function renderEmailComponent(registry: ComponentRegistry, component: string, props?: Record<string, unknown>): Promise<string> {
  const result = await registry.renderComponent(component, props, { stripMarkers: true });
  const css = result.cssUrls
    .map((url) => registry.getClientFile(url))
    .filter((c): c is string => Boolean(c))
    .join('\n');
  const head = result.head ?? '';
  const doc = stripScripts(`<!doctype html><html><head><meta charset="utf-8">${head}${css ? `<style>${css}</style>` : ''}</head><body>${result.body}</body></html>`);

  let inline: typeof import('@css-inline/css-inline').inline;
  try {
    ({ inline } = await import('@css-inline/css-inline'));
  } catch {
    throw new EmailError("The '@css-inline/css-inline' package is required to render Svelte email templates. Install it with `bun add @css-inline/css-inline`.");
  }
  return inline(doc, { keepStyleTags: true });
}

function stripScripts(html: string): string {
  return new HTMLRewriter()
    .on('script', {
      element: (el) => {
        el.remove();
      },
    })
    .transform(html);
}
