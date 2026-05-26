import { describe, expect, test } from 'bun:test';
import rehypeExternalLinks from './rehypeExternalLinks';

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function makeLink(href: string, extra?: Record<string, unknown>): HastNode {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href, ...extra },
    children: [{ type: 'text' }],
  };
}

function run(tree: HastNode): HastNode {
  rehypeExternalLinks()(tree);
  return tree;
}

describe('rehypeExternalLinks', () => {
  test('adds target and rel to external links', () => {
    const link = makeLink('https://example.com');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBe('_blank');
    expect(link.properties!.rel).toBe('noopener noreferrer nofollow');
  });

  test('skips absolute path links', () => {
    const link = makeLink('/docs/intro');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('skips anchor links', () => {
    const link = makeLink('#section');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('skips mochi.fast domain', () => {
    const link = makeLink('https://mochi.fast/docs/intro');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('skips mochi.fast subdomains', () => {
    const link = makeLink('https://demos.mochi.fast/hn');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('skips mailto links', () => {
    const link = makeLink('mailto:hello@example.com');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('skips tel links', () => {
    const link = makeLink('tel:+1234567890');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBeUndefined();
    expect(link.properties!.rel).toBeUndefined();
  });

  test('preserves existing rel values', () => {
    const link = makeLink('https://example.com', { rel: 'sponsored' });
    run({ type: 'root', children: [link] });
    expect(link.properties!.rel).toBe('sponsored noopener noreferrer nofollow');
  });

  test('deduplicates rel values', () => {
    const link = makeLink('https://example.com', { rel: 'noopener' });
    run({ type: 'root', children: [link] });
    expect(link.properties!.rel).toBe('noopener noreferrer nofollow');
  });

  test('finds nested links in deep trees', () => {
    const link = makeLink('https://example.com');
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'div',
          children: [{ type: 'element', tagName: 'p', children: [link] }],
        },
      ],
    };
    run(tree);
    expect(link.properties!.target).toBe('_blank');
    expect(link.properties!.rel).toBe('noopener noreferrer nofollow');
  });

  test('does not treat similar domains as internal', () => {
    const link = makeLink('https://notmochi.fast/foo');
    run({ type: 'root', children: [link] });
    expect(link.properties!.target).toBe('_blank');
  });
});
