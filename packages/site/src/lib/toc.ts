import type { Demo } from './demos';

export interface TocEntry {
  level: number;
  text: string;
  slug: string;
}

export interface TocGroup {
  parent: TocEntry;
  children: TocEntry[];
}

export function groupTocEntries(entries: TocEntry[]): TocGroup[] {
  const groups: TocGroup[] = [];
  let current: TocGroup | null = null;
  for (const entry of entries) {
    if (entry.level === 2) {
      current = { parent: entry, children: [] };
      groups.push(current);
    } else if (entry.level === 3 && current) {
      current.children.push(entry);
    }
  }
  return groups;
}

export function matchesQuery(text: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return text.toLowerCase().includes(query.toLowerCase());
}

export function filterTocEntries(entries: TocEntry[], query: string): TocEntry[] {
  if (!query) {
    return entries;
  }
  return entries.filter((entry) => matchesQuery(entry.text, query));
}

export function filterDemos(demos: Demo[], query: string): Demo[] {
  if (!query) {
    return demos;
  }
  return demos.filter((demo) => matchesQuery(demo.title, query) || matchesQuery(demo.hook, query));
}

export function docHref(slug: string): string {
  return `/docs/${slug}/`;
}

export function isActive(entrySlug: string, activeSlug?: string): boolean {
  if (!activeSlug) {
    return false;
  }
  return entrySlug === activeSlug;
}
