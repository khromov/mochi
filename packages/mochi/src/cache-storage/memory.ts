import type { Storage } from '../cache';

export class MemoryStorage implements Storage {
  private store = new Map<string, unknown>();

  getItem(key: string): unknown {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
