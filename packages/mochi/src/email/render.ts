import type { ComponentRegistry } from '../ComponentRegistry';

/**
 * Render a Svelte component to a standalone HTML email body via the registry's
 * stateless `renderStatic` path (no page shell, no islands, no hydration/client
 * JS), collect the component's scoped CSS, then inline it into `style=""`
 * attributes with `@css-inline/css-inline-wasm` for email-client compatibility.
 * Media queries and pseudo-classes that can't be inlined are preserved in a
 * `<style>` block (`keepStyleTags: true`).
 *
 * Email templates **always** render outside the request context — `renderStatic`
 * runs the Svelte render via `requestContext.exit`, so request-context APIs
 * (`getRequestContext`, `cookies`, `url`) throw regardless of whether the send
 * originates from a background job or a route action. Pass everything the
 * template needs via `props`. Islands (`mochi:hydrate*`) and server islands
 * (`mochi:defer*`) are a hard error.
 *
 * Any `<script>` or `<style>` in the rendered markup is stripped: email
 * clients block scripts outright, so they only bloat the message and trip spam
 * heuristics, and stray `<style>` blocks would survive css-inline's
 * `keepStyleTags` pass and ship un-inlined rules that many clients ignore. The
 * strip runs on the component body only — the framework's collected scoped CSS
 * is re-added as a head `<style>` afterward so css-inline still has it to work.
 */
export async function renderEmailComponent(registry: ComponentRegistry, component: string, props?: Record<string, unknown>): Promise<string> {
  const result = await registry.renderStatic(component, props);
  const css = result.cssUrls
    .map((url) => registry.getClientFile(url))
    .filter((c): c is string => Boolean(c))
    .join('\n');
  const head = result.head ?? '';
  const body = stripScriptsAndStyles(result.body);
  const doc = `<!doctype html><html><head><meta charset="utf-8">${head}${css ? `<style>${css}</style>` : ''}</head><body>${body}</body></html>`;

  const { inline } = await loadCssInline();
  return inline(doc, { keepStyleTags: true });
}

// We use the `-wasm` build of css-inline rather than the default
// `@css-inline/css-inline`, which ships native N-API addons (per-platform ABI
// binaries via optionalDependencies). A single portable `.wasm` keeps installs
// binary-free and identical across platforms (incl. the Docker image).
//
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
      // wasm-bindgen deprecated the positional `initWasm(bytes)` form (which is
      // what the shipped `.d.ts` still types) in favor of this single-object
      // form; passing bytes positionally works but logs a one-time "deprecated
      // parameters" warning. Hence the cast — the object form isn't in the types.
      await mod.initWasm({ module_or_path: wasmBytes } as unknown as Parameters<typeof mod.initWasm>[0]);
      return mod;
    })().catch((err) => {
      cssInlinePromise = undefined;
      throw err;
    });
  }
  return cssInlinePromise;
}

function stripScriptsAndStyles(html: string): string {
  return new HTMLRewriter()
    .on('script, style', {
      element: (el) => {
        el.remove();
      },
    })
    .transform(html);
}
