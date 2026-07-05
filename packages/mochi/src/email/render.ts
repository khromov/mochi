import type { ComponentRegistry } from '../ComponentRegistry';

/**
 * Render a Svelte component to a standalone HTML email body: SSR-render through
 * the existing registry (no page shell, no hydration/client JS), collect the
 * component's scoped CSS, then inline it into `style=""` attributes with
 * `@css-inline/css-inline-wasm` for email-client compatibility. Media queries
 * and pseudo-classes that can't be inlined are preserved in a `<style>` block
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

  const { inline } = await loadCssInline();
  return inline(doc, { keepStyleTags: true });
}

// The WASM build must be instantiated once via `initWasm` before `inline()` is
// usable (and `initWasm` refuses to run twice), so cache the load+init promise.
// The bytes are handed to `initWasm` directly rather than letting it `fetch()` a
// relative URL — there's no fetchable origin server-side.
let cssInlinePromise: Promise<typeof import('@css-inline/css-inline-wasm')> | undefined;

function loadCssInline(): Promise<typeof import('@css-inline/css-inline-wasm')> {
  if (!cssInlinePromise) {
    cssInlinePromise = (async () => {
      const mod = await import('@css-inline/css-inline-wasm');
      const wasmBytes = await Bun.file(new URL(import.meta.resolve('@css-inline/css-inline-wasm/index_bg.wasm'))).arrayBuffer();
      // The `{ module_or_path }` object form is the current, non-deprecated init
      // API but isn't reflected in the shipped types yet — passing raw bytes
      // works too but logs an upstream deprecation warning on every boot.
      await mod.initWasm({ module_or_path: wasmBytes } as unknown as Parameters<typeof mod.initWasm>[0]);
      return mod;
    })().catch((err) => {
      cssInlinePromise = undefined;
      throw err;
    });
  }
  return cssInlinePromise;
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
