// This site runs in dev mode in production to show the debug bar, which inlines build-time
// file paths as raw JSON — crawlers mine those slash-shaped strings as URLs, producing phantom
// Search Console hits. Re-encode as base64url (plain base64 still has `/`) so the payload is
// opaque to link extraction while the client decodes it back losslessly; `debugBarEncode.test.ts`
// guards the coupling to the framework's exact `<script>window.<name>=<json></script>` emission.
export const DEBUG_GLOBALS = ['__mochi_debug', '__mochi_page_entry'];

/** Rewrites the inlined debug-bar globals to base64url; `matched` lets callers detect a silent no-op if the framework's emission format drifts. */
export function encodeDebugBarGlobals(html: string): { html: string; matched: number } {
  let out = html;
  let matched = 0;
  for (const name of DEBUG_GLOBALS) {
    out = out.replace(new RegExp(`<script>window\\.${name}=(.+?)</script>`), (_m, json) => {
      matched++;
      const payload = JSON.stringify(Buffer.from(json, 'utf8').toString('base64url'));
      return `<script>window.${name}=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(${payload}.replace(/-/g,"+").replace(/_/g,"/")),(c)=>c.charCodeAt(0))))</script>`;
    });
  }
  return { html: out, matched };
}
