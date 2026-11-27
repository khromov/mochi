import { moduleRef } from 'mochi-framework';
import type { Component } from 'svelte';
import { loadPosts } from './blog';

/** Drafts are included so the map is identical in dev and prod; `loadPosts()` at runtime is what keeps them out of production responses. */
export const blogComponents: Record<string, Component> = Object.fromEntries(
  (await loadPosts({ includeDrafts: true })).map((post) => [post.slug, moduleRef<Component>(`../blog/${post.filename}`)]),
);
