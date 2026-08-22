import { describe, it, expect } from 'bun:test';
import { buildFeedXml, FEED_URL } from './feed';
import { loadPosts } from './blog';

type Item = { title: string; link: string; guid: { '#text': string }; pubDate: string; 'dc:creator': string; description?: string };
type Feed = { rss: { channel: { title: string; link: string; item: Item | Item[] } } };

const parse = (xml: string) => Bun.XML.parse(xml) as Feed;
const items = (feed: Feed) => (Array.isArray(feed.rss.channel.item) ? feed.rss.channel.item : [feed.rss.channel.item]);

describe('buildFeedXml', () => {
  it('emits a parseable RSS 2.0 document', async () => {
    const xml = await buildFeedXml();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const feed = parse(xml);
    expect(feed.rss.channel.title).toBe('Mochi');
    expect(feed.rss.channel.link).toBe('https://mochi.fast/blog/');
  });

  it('lists every published post, newest first, and never a draft', async () => {
    const posts = await loadPosts();
    const feedItems = items(parse(await buildFeedXml()));

    expect(feedItems.map((i) => i.link)).toEqual(posts.map((p) => `https://mochi.fast/blog/${p.slug}/`));
    for (const item of feedItems) {
      expect(item.link).not.toContain('mochi-on-bun-1-4');
    }
  });

  it('gives each item an RFC 822 pubDate and a permalink guid', async () => {
    const feedItems = items(parse(await buildFeedXml()));
    for (const item of feedItems) {
      // RFC 822 as RSS 2.0 requires, e.g. "Thu, 09 Jul 2026 00:00:00 GMT".
      expect(item.pubDate).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      expect(Number.isNaN(Date.parse(item.pubDate))).toBe(false);
      expect(item.guid['#text']).toBe(item.link);
    }
  });

  it('resolves the author slug to a display name in dc:creator', async () => {
    const feedItems = items(parse(await buildFeedXml()));
    expect(feedItems[0]!['dc:creator']).toBe('Stanislav');
    // RSS 2.0 specifies <author> as an email address, so a bare name must not go there.
    expect(await buildFeedXml()).not.toContain('<author>');
  });

  it('advertises its own canonical URL via atom:link', async () => {
    expect(await buildFeedXml()).toContain(`href="${FEED_URL}"`);
  });
});
