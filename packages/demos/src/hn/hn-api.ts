import { itemCache } from './hn-cache.ts';

const BASE = 'https://hacker-news.firebaseio.com/v0';

export interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time: number;
  text?: string;
  url?: string;
  title?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  dead?: boolean;
  deleted?: boolean;
}

export interface HNUser {
  id: string;
  created: number;
  karma: number;
  about?: string;
  submitted?: number[];
}

export interface HNCommentNode extends HNItem {
  children: HNCommentNode[];
}

export async function fetchItem(id: number): Promise<HNItem | null> {
  return itemCache.fetch(`item:${id}`, async () => {
    const res = await fetch(`${BASE}/item/${id}.json`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  });
}

export async function fetchUser(username: string): Promise<HNUser | null> {
  const res = await fetch(`${BASE}/user/${encodeURIComponent(username)}.json`);
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export async function fetchStoryIds(type: string): Promise<number[]> {
  const res = await fetch(`${BASE}/${encodeURIComponent(type)}.json`);
  if (!res.ok) {
    return [];
  }
  return res.json();
}

export async function fetchStories(type: string, page: number = 0, pageSize: number = 30): Promise<{ items: HNItem[]; total: number }> {
  const ids = await fetchStoryIds(type);
  const start = page * pageSize;
  const slice = ids.slice(start, start + pageSize);
  const items = await Promise.all(slice.map(fetchItem));
  return {
    items: items.filter((i): i is HNItem => i !== null),
    total: ids.length,
  };
}

export async function fetchCommentTree(ids: number[], maxDepth: number = 5, currentDepth: number = 0): Promise<HNCommentNode[]> {
  if (currentDepth >= maxDepth || ids.length === 0) {
    return [];
  }
  const items = await Promise.all(ids.map(fetchItem));
  const results: HNCommentNode[] = [];
  for (const item of items) {
    if (!item || item.deleted || item.dead) {
      continue;
    }
    const children = item.kids ? await fetchCommentTree(item.kids, maxDepth, currentDepth + 1) : [];
    results.push({ ...item, children });
  }
  return results;
}
