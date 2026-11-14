import { requestContext } from './requestContext';

/**
 * Prologue the preprocessor injects into every component with prunable scoped CSS (see `instrumentCssTracking`), so
 * `renderComponent` links only the stylesheets of components that actually rendered in this response.
 */
export function markRenderedCss(key: string): void {
  requestContext.getStore()?.renderedCss?.add(key);
}
