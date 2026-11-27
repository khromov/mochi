export interface ScriptTag {
  type: string | null;
  nonce: string | null;
  src: string | null;
  text: string;
}

/** Every `<script>` in `html`, read with Bun's HTML parser so a `<script` inside an inlined bundle is not miscounted. */
export async function scriptTags(html: string): Promise<ScriptTag[]> {
  const tags: ScriptTag[] = [];
  await new HTMLRewriter()
    .on('script', {
      element(el) {
        tags.push({ type: el.getAttribute('type'), nonce: el.getAttribute('nonce'), src: el.getAttribute('src'), text: '' });
      },
      text(chunk) {
        tags[tags.length - 1]!.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();
  return tags;
}

/** Whether CSP `script-src` gates this tag: classic and module scripts, and speculation rules — not JSON data blocks. */
export function isGated(tag: ScriptTag): boolean {
  return tag.type === null || tag.type === '' || tag.type === 'module' || tag.type === 'text/javascript' || tag.type === 'speculationrules';
}

export function headerNonce(res: Response): string | undefined {
  return /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '')?.[1];
}
