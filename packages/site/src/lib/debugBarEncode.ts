// We run this site in dev mode in production to show off the debug bar. The debug bar inlines
// build-time file paths (e.g. "../mochi/src/cookies.client.ts") as raw JSON in executable
// <script>s; crawlers mine those slash-shaped strings as relative URLs and resolve them against
// the page, producing phantom Search Console URLs like /mochi/src/cookies.client.ts. Re-encode the
// payload so it's opaque to static link extraction — the client decodes back to the same value,
// leaving the debug bar fully functional.
//
// base64url (not plain base64) is deliberate: the standard base64 alphabet still contains `/`, so
// an encoded blob would re-introduce the very slash-shaped strings we're trying to eliminate.
// base64url uses `-`/`_` instead, so the payload is guaranteed slash-free. The client maps those
// back to `+`/`/` before atob.
//
// The framework emits these as `<script>window.<name>=<json></script>` (see Mochi.ts
// resolveHtmlShell). jsonForHtml escapes `<`, so the JSON never contains a literal `</script>`,
// making the non-greedy match safe. The match is coupled to that exact emission format; debugBarEncode.test.ts
// boots a real Mochi dev server and asserts we still match, so a framework format change fails loudly.
export const DEBUG_GLOBALS = ['__mochi_debug', '__mochi_page_entry'];

/**
 * Rewrite the inlined debug-bar globals to a base64url-encoded form. Returns the transformed
 * HTML plus the number of globals actually re-encoded, so callers can detect a silent no-op
 * (framework emission format drifted) instead of letting phantom URLs quietly return.
 */
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
