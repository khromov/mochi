/**
 * Register a web component (custom element) — local or from npm — on the client.
 *
 * Mochi rewrites calls to this at build time, per target:
 * - **client** bundle → `import('<specifier>')`, so the module is bundled and its
 *   `customElements.define()` runs on hydration, upgrading the server-rendered tag.
 * - **server** bundle → a no-op, so the module — which references browser-only
 *   globals like `HTMLElement` at module-eval time — is never loaded during SSR.
 *
 * The server still renders the element's tag; give it light-DOM fallback content
 * for the pre-hydration paint (shadow DOM is a client-side concern).
 *
 * The argument MUST be a static string literal so the build can capture and bundle
 * it — exactly like a native dynamic `import()`.
 *
 * ```svelte
 * <script>
 *   import { importWebComponent } from 'mochi-framework';
 *   await importWebComponent('./click-counter.ts');
 *   await importWebComponent('@github/relative-time-element');
 * </script>
 * ```
 */
export function importWebComponent(specifier: string): Promise<void> {
  // Runtime fallback for uncompiled contexts (e.g. SSR, or a call outside a
  // compiled component). On the server this is the intended no-op; inside a
  // compiled island the call site is rewritten to a real `import()`.
  void specifier;
  return Promise.resolve();
}

const IMPORT_WC_RE = /\bimportWebComponent\s*\(\s*(['"`][^'"`)]+['"`])\s*\)/g;

/**
 * Build-time rewrite of `importWebComponent('<specifier>')` call sites:
 * - `client` → `import('<specifier>')` (literal preserved so Bun bundles the target)
 * - `server` → `Promise.resolve()` (specifier dropped; module never enters the SSR graph)
 */
export function transformImportWebComponent(code: string, target: 'server' | 'client'): string {
  if (!code.includes('importWebComponent')) {
    return code;
  }
  return code.replace(IMPORT_WC_RE, (_match, literal) => (target === 'server' ? 'Promise.resolve()' : `import(${literal})`));
}
