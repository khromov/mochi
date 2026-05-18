const STORAGE_KEY = 'likes';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

let likes: number | null = $state(stored !== null ? Number(stored) : null);

export function getLikes(): number | null {
  return likes;
}

export function like() {
  likes = (likes ?? 0) + 1;
  localStorage.setItem(STORAGE_KEY, String(likes));
}
