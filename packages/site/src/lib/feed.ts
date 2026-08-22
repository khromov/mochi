import { getAuthor } from './authors';
import { loadPosts } from './blog';
import { SITE_BASE, XML_DECLARATION } from './docs';

const FEED_PATH = '/feed.xml';
const TITLE = 'Mochi';
const DESCRIPTION = 'An islands framework for Svelte 5 and Bun.';

export const FEED_URL = `${SITE_BASE}${FEED_PATH}`;
export const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8';

let cachedFeedXml: string | null = null;

export function clearFeedCache(): void {
  cachedFeedXml = null;
}

/** RFC 822, which RSS 2.0 requires — `Date#toUTCString()` already emits exactly that shape. */
function pubDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

/**
 * The blog as an RSS 2.0 feed. Summaries only: post bodies are mdsvex and may embed Svelte components, which have no
 * meaning outside the site. Every value goes through `Bun.XML.stringify`, so titles containing `&` or `<` escape.
 */
export async function buildFeedXml(): Promise<string> {
  if (cachedFeedXml) {
    return cachedFeedXml;
  }
  // Published posts only — loadPosts() without includeDrafts never exposes drafts.
  const posts = await loadPosts();
  const items = posts.map((post) => {
    const link = `${SITE_BASE}/blog/${post.slug}/`;
    return {
      title: post.title,
      link,
      // Permanent and never re-used, so readers can dedupe across a changed link.
      guid: { '@isPermaLink': 'true', '#text': link },
      pubDate: pubDate(post.date),
      // dc:creator, not RSS 2.0's <author>: that one is specified as an email address, and validators reject a bare name.
      'dc:creator': getAuthor(post.author).name,
      ...(post.description ? { description: post.description } : {}),
    };
  });

  cachedFeedXml = `${XML_DECLARATION}\n${Bun.XML.stringify({
    rss: {
      '@version': '2.0',
      '@xmlns:atom': 'http://www.w3.org/2005/Atom',
      '@xmlns:dc': 'http://purl.org/dc/elements/1.1/',
      channel: {
        title: TITLE,
        link: `${SITE_BASE}/blog/`,
        description: DESCRIPTION,
        language: 'en',
        // Points readers at the canonical feed URL even when they found it via a mirror.
        'atom:link': { '@href': FEED_URL, '@rel': 'self', '@type': 'application/rss+xml' },
        ...(posts[0] ? { lastBuildDate: pubDate(posts[0].date) } : {}),
        item: items,
      },
    },
  })}\n`;
  return cachedFeedXml;
}
