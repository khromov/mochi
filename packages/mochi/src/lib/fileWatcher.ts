import { EventEmitter } from 'node:events';
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

export type FileChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/** A path is ignored if any RegExp matches it or any predicate returns true. */
export type IgnoreMatcher = RegExp | ((path: string) => boolean);

export interface CreateWatcherOptions {
  ignored?: IgnoreMatcher[];
  cwd?: string;
}

/**
 * The slice of chokidar that Mochi's dev watcher actually uses, rebuilt on Bun's
 * native recursive `fs.watch` so the framework ships no watch dependency.
 *
 * Emits chokidar-shaped events: a generic `'all'` (kind, cwd-relative path) plus
 * a per-kind event, then `'ready'` once and `'error'` per failure. Paths are
 * emitted relative to `cwd` to match chokidar's `cwd` option, which the call
 * site relies on for `startsWith(publicDirRel + sep)` routing.
 *
 * `fs.watch` only distinguishes `'rename'` from `'change'`, so add/unlink are
 * recovered by `statSync` + a seen-path map. Directory targets are watched
 * recursively; file targets are watched via their parent directory so atomic
 * saves (rename-over) and create-when-absent are still caught.
 *
 * Like chokidar, this inherits `fs.watch`'s OS-level event coalescing: events
 * fired in very rapid succession on the same path can be collapsed (e.g. on
 * Linux inotify, a delete landing within milliseconds of a preceding write may
 * be dropped). Harmless for a dev watcher — human-paced saves are spaced out,
 * and a missed `unlink` only leaves a stale cache entry corrected on next edit.
 */
class FileWatcher extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private readonly cwd: string;
  private readonly ignored: IgnoreMatcher[];
  private readonly seen = new Map<string, 'file' | 'dir'>();
  private readonly recent = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(paths: string[], opts: CreateWatcherOptions) {
    super();
    this.cwd = opts.cwd ?? process.cwd();
    this.ignored = opts.ignored ?? [];

    for (const target of paths) {
      this.watchTarget(target);
    }

    // fs.watch is active synchronously; defer 'ready' so the caller's
    // `.once('ready', …)` (attached synchronously after construction) is wired
    // before it fires.
    queueMicrotask(() => {
      if (!this.closed) {
        this.emit('ready');
      }
    });
  }

  private watchTarget(target: string): void {
    let isDir = false;
    try {
      isDir = statSync(target).isDirectory();
    } catch {
      // Target doesn't exist yet (e.g. svelte.config.js): fall through to
      // parent-directory watching so we still catch its creation.
    }

    if (isDir) {
      this.attach(target, true);
      return;
    }

    // File (or not-yet-created) target: watch its parent so renames and atomic
    // saves — which swap the inode and would silently kill a direct file watch —
    // are still observed. Filter the parent's events down to this basename.
    const parent = path.dirname(target);
    if (!existsSync(parent)) {
      return;
    }
    this.attach(parent, false, path.basename(target));
  }

  private attach(watchRoot: string, recursive: boolean, onlyBase?: string): void {
    let w: FSWatcher;
    try {
      w = watch(watchRoot, { recursive });
    } catch (err) {
      this.emit('error', err);
      return;
    }
    w.on('change', (rawEvent, filename) => {
      if (filename == null) {
        return;
      }
      const abs = path.resolve(watchRoot, filename.toString());
      if (onlyBase != null && path.basename(abs) !== onlyBase) {
        return;
      }
      this.handle(rawEvent, abs);
    });
    w.on('error', (err) => this.emit('error', err));
    this.watchers.push(w);
  }

  private handle(rawEvent: string, abs: string): void {
    const rel = path.relative(this.cwd, abs);
    if (this.isIgnored(abs, rel)) {
      return;
    }
    const kind = this.classify(rawEvent, abs);
    if (kind == null) {
      return;
    }
    const key = `${kind}:${rel}`;
    if (this.recent.has(key)) {
      return;
    }
    const timer = setTimeout(() => this.recent.delete(key), 20);
    timer.unref?.();
    this.recent.set(key, timer);

    this.emit('all', kind, rel);
    this.emit(kind, rel);
  }

  private classify(rawEvent: string, abs: string): FileChangeKind | null {
    let isDirectory: boolean | null;
    try {
      isDirectory = statSync(abs).isDirectory();
    } catch {
      isDirectory = null; // path is gone
    }

    if (isDirectory === null) {
      const known = this.seen.get(abs);
      if (!known) {
        return null;
      }
      this.seen.delete(abs);
      return known === 'dir' ? 'unlinkDir' : 'unlink';
    }

    if (isDirectory) {
      if (this.seen.get(abs) === 'dir') {
        return null; // directory touch, not a creation
      }
      this.seen.set(abs, 'dir');
      return 'addDir';
    }

    const known = this.seen.get(abs);
    this.seen.set(abs, 'file');
    // A raw 'change' is always a modification; a 'rename' on a file we've never
    // seen is a creation, otherwise it's an atomic save over an existing file.
    if (rawEvent === 'change') {
      return 'change';
    }
    return known === 'file' ? 'change' : 'add';
  }

  private isIgnored(abs: string, rel: string): boolean {
    for (const matcher of this.ignored) {
      if (matcher instanceof RegExp) {
        if (matcher.test(rel)) {
          return true;
        }
      } else if (matcher(abs)) {
        return true;
      }
    }
    return false;
  }

  close(): void {
    this.closed = true;
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
    for (const timer of this.recent.values()) {
      clearTimeout(timer);
    }
    this.recent.clear();
  }
}

export function createWatcher(paths: string[], opts: CreateWatcherOptions = {}): FileWatcher {
  return new FileWatcher(paths, opts);
}

export type { FileWatcher };
