import type { ComponentRegistry } from '../compiler/ComponentRegistry';

/**
 * Render a Svelte component to a standalone HTML email body through the registry's stateless `renderStatic` path,
 * collect its scoped CSS, then inline that into `style=""` attributes with `@css-inline/css-inline-wasm` for
 * email-client compatibility. Media queries and pseudo-classes that resist inlining stay in a `<style>` block.
 *
 * Email templates **always** render outside the request context, since `renderStatic` runs via `requestContext.exit`, so
 * `getRequestContext`, `cookies`, and `url` throw whether the send comes from a background job or a route action — pass
 * everything the template needs via `props`. Islands and server islands are a hard error.
 *
 * Any `<script>` or `<style>` in the rendered markup is stripped: email clients block scripts outright, so they only
 * bloat the message and trip spam heuristics, and stray `<style>` blocks would survive css-inline's `keepStyleTags` pass
 * and ship un-inlined rules many clients ignore. The strip covers the component body alone, with the collected scoped
 * CSS re-added as a head `<style>` afterward so css-inline still has it to work from.
 */
export async function renderEmailComponent(registry: ComponentRegistry, component: string, props?: Record<string, unknown>): Promise<string> {
  const result = await registry.renderStatic(component, props);
  const css = await inlineExtractedFonts(
    result.cssUrls
      .map((url) => registry.getClientFile(url))
      .filter((c): c is string => Boolean(c))
      .join('\n'),
    registry,
  );
  const head = result.head ?? '';
  const body = stripScriptsAndStyles(result.body);
  const doc = `<!doctype html><html><head><meta charset="utf-8">${head}${css ? `<style>${css}</style>` : ''}</head><body>${body}</body></html>`;

  const { inline } = await loadCssInline();
  return inline(doc, { keepStyleTags: true });
}

// Imported CSS refers to its extracted fonts by root-relative `/_mochi/fonts/*` URLs, which have no origin to resolve
// against inside a standalone email document — the bytes go back in as self-contained `data:` URIs.
async function inlineExtractedFonts(css: string, registry: ComponentRegistry): Promise<string> {
  for (const [url, asset] of registry.getFontAssets()) {
    if (!css.includes(url)) {
      continue;
    }
    const b64 = Buffer.from(await Bun.file(asset.diskPath).bytes()).toString('base64');
    const dataUri = `url("data:${asset.contentType};base64,${b64}")`;
    css = css.replaceAll(`url(${url})`, dataUri).replaceAll(`url("${url}")`, dataUri);
  }
  return css;
}

// The `-wasm` build stands in for the default `@css-inline/css-inline`, whose native N-API addons ship per-platform ABI
// binaries through optionalDependencies; one portable `.wasm` keeps installs binary-free and identical everywhere,
// Docker image included.
//
// `initWasm` must run once before `inline()` is usable and refuses to run twice, so the load+init promise is cached.
// The bytes go to `initWasm` directly, since a relative `fetch()` has no origin to hit server-side.
let cssInlinePromise: Promise<typeof import('@css-inline/css-inline-wasm')> | undefined;

function loadCssInline(): Promise<typeof import('@css-inline/css-inline-wasm')> {
  if (!cssInlinePromise) {
    cssInlinePromise = (async () => {
      const mod = await import('@css-inline/css-inline-wasm');
      const wasmBytes = await Bun.file(new URL(import.meta.resolve('@css-inline/css-inline-wasm/index_bg.wasm'))).arrayBuffer();
      // wasm-bindgen deprecated the positional `initWasm(bytes)` form the shipped `.d.ts` still types, in favour of
      // this object form; the cast is needed because the object form isn't in those types.
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
