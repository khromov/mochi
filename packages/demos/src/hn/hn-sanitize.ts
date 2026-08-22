import { decode as decodeHtmlEntities } from 'html-entities';

const allowedTags = new Set(['p', 'a', 'i', 'b', 'code', 'pre']);
const removeTags = new Set(['script', 'style', 'iframe', 'object', 'embed']);

/** Normalizes to an http(s) URL or null; parsing through `URL` neutralizes `javascript:`/`data:` and attribute-breaking payloads before they reach an `href`. */
export function safeUrl(url: string | undefined | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Sanitizes HN API HTML with an allowlist `HTMLRewriter` pass, since HN comments are user-authored and must never carry executable content into the page. */
export function sanitizeHtml(html: string): string {
  return new HTMLRewriter()
    .on('*', {
      element(el) {
        if (removeTags.has(el.tagName)) {
          el.remove();
          return;
        }
        if (!allowedTags.has(el.tagName)) {
          el.remove();
          return;
        }
        const attrs = [...el.attributes].map(([name]) => name);
        for (const name of attrs) {
          if (el.tagName === 'a' && name === 'href') {
            continue;
          }
          el.removeAttribute(name);
        }
        if (el.tagName === 'a') {
          const rawHref = el.getAttribute('href');
          const safeHref = safeUrl(rawHref ? decodeHtmlEntities(rawHref) : rawHref);
          if (safeHref === null) {
            el.removeAttribute('href');
          } else {
            el.setAttribute('href', safeHref);
          }
          el.setAttribute('rel', 'nofollow noopener noreferrer');
        }
      },
    })
    .transform(html);
}

/** Converts HN HTML to plain text for previews; a final `html-entities` decode pass is needed since Bun's `HTMLRewriter` text chunks arrive undecoded. */
export function htmlToText(html: string): string {
  let out = '';
  let skipDepth = 0;
  new HTMLRewriter()
    .on('script, style, iframe, object, embed', {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on('p, div, br, li, tr, h1, h2, h3, h4, h5, h6', {
      element() {
        out += ' ';
      },
    })
    .onDocument({
      text(chunk) {
        if (skipDepth === 0) {
          out += chunk.text;
        }
      },
    })
    .transform(html);
  return decodeHtmlEntities(out).replace(/\s+/g, ' ').trim();
}
