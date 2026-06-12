import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWatcher, type FileChangeKind, type FileWatcher } from './fileWatcher';

let dir: string;
let watcher: FileWatcher | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mochi-watch-'));
});

afterEach(() => {
  watcher?.close();
  watcher = undefined;
  rmSync(dir, { recursive: true, force: true });
});

// The OS needs a beat to register a freshly-attached fs.watch before mutations
// are reliably reported — more so when the full suite runs many watch tests in
// parallel processes. Settle before the first write that an assertion depends on.
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 80));
}

// fs.watch latency varies by platform, so wait for a matching event rather than
// asserting synchronously after the filesystem mutation.
function nextEvent(w: FileWatcher, predicate: (kind: FileChangeKind, rel: string) => boolean, timeoutMs = 8000): Promise<{ kind: FileChangeKind; rel: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.off('all', onAll);
      reject(new Error('timed out waiting for event'));
    }, timeoutMs);
    function onAll(kind: FileChangeKind, rel: string) {
      if (predicate(kind, rel)) {
        clearTimeout(timer);
        w.off('all', onAll);
        resolve({ kind, rel });
      }
    }
    w.on('all', onAll);
  });
}

test("emits 'ready' once", async () => {
  watcher = createWatcher([dir]);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no ready')), 2000);
    watcher!.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

test("classifies a new file as 'add'", async () => {
  watcher = createWatcher([dir], { cwd: dir });
  const target = path.join(dir, 'a.txt');
  await settle();
  const p = nextEvent(watcher, (kind, rel) => rel === 'a.txt' && kind === 'add');
  writeFileSync(target, 'one');
  await p;
});

test("classifies a modification of an existing file as 'change'", async () => {
  const target = path.join(dir, 'b.txt');
  writeFileSync(target, 'one');
  watcher = createWatcher([dir], { cwd: dir });
  const p = nextEvent(watcher, (kind, rel) => rel === 'b.txt' && kind === 'change');
  // Give the watcher a beat to attach before mutating.
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(target, 'two');
  await p;
});

test("classifies a deletion as 'unlink'", async () => {
  const target = path.join(dir, 'c.txt');
  watcher = createWatcher([dir], { cwd: dir });
  await settle();
  // Create under the watcher and wait for 'add' — this seeds the seen-map so the
  // delete can be classified. Then settle again before deleting: a delete fired
  // immediately after a preceding write to the same path gets coalesced away by
  // the OS watch layer (observed on Linux inotify), dropping the 'unlink'.
  const added = nextEvent(watcher, (kind, rel) => rel === 'c.txt' && kind === 'add');
  writeFileSync(target, 'one');
  await added;
  await settle();
  const removed = nextEvent(watcher, (kind, rel) => rel === 'c.txt' && kind === 'unlink');
  rmSync(target);
  await removed;
});

test('detects a file added in a nested subdirectory', async () => {
  const sub = path.join(dir, 'nested');
  mkdirSync(sub);
  watcher = createWatcher([dir], { cwd: dir });
  await new Promise((r) => setTimeout(r, 50));
  const p = nextEvent(watcher, (kind, rel) => rel === path.join('nested', 'deep.txt') && kind === 'add');
  writeFileSync(path.join(sub, 'deep.txt'), 'x');
  await p;
});

test('emits cwd-relative paths', async () => {
  watcher = createWatcher([dir], { cwd: dir });
  await settle();
  const p = nextEvent(watcher, (_kind, rel) => rel === 'rel.txt');
  writeFileSync(path.join(dir, 'rel.txt'), 'x');
  const { rel } = await p;
  expect(path.isAbsolute(rel)).toBe(false);
});

test('honors RegExp and predicate ignore matchers', async () => {
  mkdirSync(path.join(dir, 'node_modules'));
  watcher = createWatcher([dir], {
    cwd: dir,
    ignored: [/(^|[/\\])node_modules([/\\]|$)/, (p) => p.endsWith('.skip')],
  });
  let leaked = false;
  watcher.on('all', (_kind, rel) => {
    if (rel.includes('node_modules') || rel.endsWith('.skip')) {
      leaked = true;
    }
  });
  await new Promise((r) => setTimeout(r, 50));
  // Space the writes out: bursts get coalesced/dropped by the OS watch layer,
  // which would mask (not falsify) the ignore assertion.
  writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'x');
  await new Promise((r) => setTimeout(r, 120));
  writeFileSync(path.join(dir, 'ignored.skip'), 'x');
  await new Promise((r) => setTimeout(r, 120));
  // A non-ignored write proves the watcher is live and flushes the queue.
  const p = nextEvent(watcher, (_kind, rel) => rel === 'kept.txt');
  writeFileSync(path.join(dir, 'kept.txt'), 'x');
  await p;
  expect(leaked).toBe(false);
});

test('watches a single file target via its parent directory', async () => {
  const target = path.join(dir, 'config.js');
  watcher = createWatcher([target], { cwd: dir });
  await settle();
  const created = nextEvent(watcher, (kind, rel) => rel === 'config.js' && kind === 'add');
  writeFileSync(target, 'export default {}');
  await created;
  const changed = nextEvent(watcher, (kind, rel) => rel === 'config.js' && kind === 'change');
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(target, 'export default { x: 1 }');
  await changed;
});

test('a sibling change does not leak into a single-file watch', async () => {
  const target = path.join(dir, 'watched.js');
  writeFileSync(target, 'a');
  watcher = createWatcher([target], { cwd: dir });
  let leaked = false;
  watcher.on('all', (_kind, rel) => {
    if (rel === 'sibling.js') {
      leaked = true;
    }
  });
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(path.join(dir, 'sibling.js'), 'b');
  await new Promise((r) => setTimeout(r, 120));
  // Drive a real event on the watched file to flush the queue.
  const p = nextEvent(watcher, (_kind, rel) => rel === 'watched.js');
  writeFileSync(target, 'c');
  await p;
  expect(leaked).toBe(false);
});

test('close stops further events', async () => {
  watcher = createWatcher([dir], { cwd: dir });
  await new Promise((r) => setTimeout(r, 50));
  let count = 0;
  watcher.on('all', () => {
    count += 1;
  });
  watcher.close();
  writeFileSync(path.join(dir, 'after-close.txt'), 'x');
  await new Promise((r) => setTimeout(r, 200));
  expect(count).toBe(0);
});
