import { describe, it, expect } from 'bun:test';
import { loadPosts, getPost, draftsVisible } from './blog';

describe('loadPosts', () => {
  it('excludes drafts by default', async () => {
    const posts = await loadPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => !p.draft)).toBe(true);
  });

  it('sorts newest first', async () => {
    const posts = await loadPosts({ includeDrafts: true });
    const dates = posts.map((p) => p.date);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });

  it('every post has a valid date and slug', async () => {
    for (const post of await loadPosts({ includeDrafts: true })) {
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(post.slug).not.toBe('');
      expect(post.title).not.toBe('');
    }
  });
});

describe('getPost', () => {
  it('returns a published post without any flag', async () => {
    const post = await getPost('hello-world');
    expect(post?.title).toBe('Hello World');
    expect(post?.draft).toBe(false);
  });

  it('returns null for an unknown slug', async () => {
    expect(await getPost('nope', { includeDrafts: true })).toBeNull();
  });
});

describe('draftsVisible', () => {
  it('shows drafts only in local dev, not in the dev-mode Docker deploy', () => {
    expect(draftsVisible({ NODE_ENV: 'development' })).toBe(true);
    expect(draftsVisible({ NODE_ENV: 'development', MOCHI_DOCKER: 'true' })).toBe(false);
    expect(draftsVisible({ NODE_ENV: 'production' })).toBe(false);
    expect(draftsVisible({})).toBe(false);
  });
});
