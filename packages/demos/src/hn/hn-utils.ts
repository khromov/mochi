import { htmlToText } from './hn-sanitize.ts';

export const PAGE_SIZE = 30;
export const RECENT_SUBMISSIONS_LIMIT = 30;
export const COMMENT_MAX_DEPTH = 5;
export const COMMENT_MAX_INDENT = 8;
export const COMMENT_INDENT_PX = 20;
export const COMMENT_INITIAL_COUNT = 3;
export const PREVIEW_LEN = 80;

export const STORY_TYPES = {
  topstories: { label: 'Top', path: 'front' },
  newstories: { label: 'New', path: 'new' },
  askstories: { label: 'Ask HN', path: 'ask' },
  showstories: { label: 'Show HN', path: 'show' },
  jobstories: { label: 'Jobs', path: 'jobs' },
} as const;

export type StoryType = keyof typeof STORY_TYPES;

export function timeAgo(unix: number): string {
  const seconds = Math.floor(Date.now() / 1000) - unix;
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function previewText(text: string, maxLen: number = PREVIEW_LEN): string {
  const stripped = htmlToText(text);
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen)}…` : stripped;
}
