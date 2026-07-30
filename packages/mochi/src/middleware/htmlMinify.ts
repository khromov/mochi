import type { Handle } from '../runtime/hooks';
import { getMochiConfig } from '../mochiConfig';
import { isSvelteMarker } from '../utils';

export interface HtmlMinifyOptions {
  /** Collapse runs of inter-element whitespace to a single space. Default `true`. */
  collapseWhitespace?: boolean;
  /** Strip HTML comments that are not Svelte/island hydration markers. Default `true`. */
  removeComments?: boolean;
  /** Run in development too. Default `false` — like `compress()`, minification is skipped in dev. */
  dev?: boolean;
}

interface MinifyConfig {
  collapseWhitespace: boolean;
  removeComments: boolean;
}

function isDev(): boolean {
  try {
    return getMochiConfig().options.development ?? true;
  } catch {
    // Mochi.serve() hasn't initialized config (e.g. unit tests) — assume prod.
    return false;
  }
}

// Whitespace inside these must survive verbatim: `pre`/`textarea`/`script`/`style` carry significant or raw content,
// and island subtrees are re-walked by the client hydrator, so any change there is a hydration mismatch.
const PRESERVE_SELECTOR = 'pre, textarea, script, style, mochi-hydratable-island, mochi-server-island';

/**
 * Conservatively minify a full HTML document: collapse inter-element whitespace to single spaces and drop author
 * comments, leaving `<pre>`/`<textarea>`/`<script>`/`<style>` and island subtrees byte-for-byte intact.
 *
 * A per-chunk `preserve` flag replaces an `el.onEndTag()` depth counter, which leaks the request's `AsyncLocalStorage`
 * frame on Bun <1.4.0 (see `stripHydrationMarkers`): lol-html runs the element-scoped handler immediately before the
 * document handler for the same node — including descendants — so the flag is set exactly when the document handler
 * needs it and reset right after.
 */
export function minifyHtml(html: string, cfg: MinifyConfig): string {
  let preserve = false;
  const markPreserved = {
    text() {
      preserve = true;
    },
    comments() {
      preserve = true;
    },
  };

  return new HTMLRewriter()
    .on(PRESERVE_SELECTOR, markPreserved)
    .onDocument({
      text(chunk) {
        if (preserve) {
          preserve = false;
          return;
        }
        if (cfg.collapseWhitespace) {
          chunk.replace(chunk.text.replace(/\s+/g, ' '));
        }
      },
      comments(comment) {
        if (preserve) {
          preserve = false;
          return;
        }
        if (cfg.removeComments && !isSvelteMarker(comment.text)) {
          comment.remove();
        }
      },
    })
    .transform(html);
}

/**
 * Composable middleware that minifies page HTML. Place it early in `sequence(...)` (right after `compress()`): merged
 * `transformPage`s stack in reverse, so an early handler transforms last — after content-injecting handlers have added
 * their markup and before `compress()` gzips the result. Skipped in development unless `opts.dev` is set.
 */
export function htmlMinify(opts: HtmlMinifyOptions = {}): Handle {
  const cfg: MinifyConfig = {
    collapseWhitespace: opts.collapseWhitespace ?? true,
    removeComments: opts.removeComments ?? true,
  };
  const runInDev = opts.dev ?? false;

  return async ({ event, resolve }) => {
    if (!runInDev && isDev()) {
      return resolve(event);
    }
    return resolve(event, {
      transformPage: ({ html, done }) => (done ? minifyHtml(html, cfg) : html),
    });
  };
}
