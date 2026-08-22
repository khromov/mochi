import { compiled, moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadPosts } from './blog';

/**
 * Every blog post, keyed by slug.
 *
 * Drafts are included so the map is identical in dev and prod; `loadPosts()` at runtime is what keeps them out of
 * production responses.
 */
export const blogComponents: Record<string, Component> = await compiled(async () => {
  const posts = await loadPosts({ includeDrafts: true });
  return Object.fromEntries(posts.map((post) => [post.slug, moduleRef<Component>(`../blog/${post.filename}`)]));
});
