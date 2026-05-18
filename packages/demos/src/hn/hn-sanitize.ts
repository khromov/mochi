import { decode as decodeHtmlEntities } from 'html-entities';

const allowedTags = new Set(['p', 'a', 'i', 'b', 'code', 'pre']);
const removeTags = new Set(['script', 'style', 'iframe', 'object', 'embed']);

/**
 * Returns a normalized URL only if it parses and uses an http(s) scheme;
 * otherwise null. Parsing through `URL` percent-encodes whitespace and
 * attribute-breaking characters, so `javascript:`, `data:`, and tricks like
 * `http://evil.example "onclick=...` cannot survive into an `href`.
 */
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

/**
 * Sanitizes HTML from the HN API using Bun's HTMLRewriter.
 * - Allows only safe formatting tags (p, a, i, b, code, pre)
 * - Removes dangerous tags (script, style, iframe, etc.) entirely
 * - Unwraps other tags, keeping their text content
 * - Strips all attributes except href on <a> (http/https only)
 */
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

/**
 * Converts HN-flavoured HTML into a plain-text string suitable for previews.
 * Uses `HTMLRewriter` to drop tags, suppress the contents of removed elements
 * (script/style/etc.) via an `onEndTag` skip-scope, and inserts spaces around
 * block-level tags so paragraphs don't collide. Bun's text chunks don't decode
 * entities, so the final pass runs the output through `html-entities`.
 */
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
