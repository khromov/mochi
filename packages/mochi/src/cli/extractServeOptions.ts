import path from 'node:path';
import { freshImport } from '../compiler/freshImport';
import { runInEntryImportScope } from '../utils/buildFlag';
import type { MochiServeOptions, MochiStandaloneOptions } from '../types';

// Thrown by the capturing serve() stub to unwind the entry module's top-level
// `await Mochi.serve(...)` before the real server binds a port. Symbol-keyed so a
// user's own `throw {}` can never be mistaken for it.
const HALT = Symbol('mochi.extract.halt');
type HaltSignal = { [HALT]: true };
function isHalt(err: unknown): err is HaltSignal {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[HALT] === true;
}

type CapturedEntryCall = { fn: 'serve'; options: Partial<MochiServeOptions> } | { fn: 'standalone'; options: MochiStandaloneOptions };

let pluginRegistrationDone = false;
let captured: CapturedEntryCall | null = null;

/**
 * Import a Mochi entry module far enough to capture the options object it passes to `Mochi.serve()` or
 * `Mochi.standalone()`, leaving nothing running. A `Bun.plugin` virtual module overrides the bare `mochi-framework`
 * specifier, re-exporting the real framework entry by absolute file path so the plugin can't intercept itself, and
 * replacing both entry statics with stubs that record their argument and throw a sentinel to halt the entry's
 * top-level await. The captured object is fully evaluated, so options like `optimize` match what the runtime would use.
 */
export async function extractEntryCall(entryPath: string, opts?: { fresh?: boolean }): Promise<CapturedEntryCall | null> {
  // The real framework entry, by absolute path — NOT the bare specifier, so the
  // plugin below does not intercept this import (no recursion). This file lives
  // in `src/cli/`, so climb one level to reach it.
  const realMod = (await import(path.join(import.meta.dir, '..', 'index.ts'))) as Record<string, unknown> & {
    Mochi: object;
  };

  if (!pluginRegistrationDone) {
    // A Proxy preserves Mochi's non-enumerable static methods
    // (page/api/ws/sse) so route modules still build during extraction; only
    // the entry statics are swapped for capturing stubs.
    const capturingStub = (fn: CapturedEntryCall['fn']) => (options: never) => {
      // A second call within one extraction means the entry swallowed the halt sentinel — say, a
      // `try { await Mochi.serve(...) } catch {}` — and kept running, so a real error surfaces it here instead of
      // silently capturing stale options.
      if (captured !== null) {
        throw new Error(
          `Mochi.${fn}() was called more than once while extracting build options. Do not wrap the top-level Mochi.${fn}() call in try/catch — it must be allowed to throw during extraction.`,
        );
      }
      captured = { fn, options } as CapturedEntryCall;
      throw { [HALT]: true } as HaltSignal;
    };
    const mochiProxy = new Proxy(realMod.Mochi, {
      get(target, prop, receiver) {
        // Synchronous capture + throw, before the first await inside serve()/standalone(), so the
        // sentinel rejects the entry's top-level await and unwinds cleanly.
        if (prop === 'serve' || prop === 'standalone') {
          return capturingStub(prop);
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    Bun.plugin({
      name: 'mochi-extract-serve-options',
      setup(build) {
        build.module('mochi-framework', () => ({
          loader: 'object',
          exports: {
            ...realMod,
            default: (realMod as { default?: unknown }).default ?? realMod,
            Mochi: mochiProxy,
            // Overridden rather than read from `realMod`, whose namespace is snapshotted here: only the module graph
            // imported for extraction is "building", so a dev-watcher re-import must not flip the flag process-wide.
            isBuilding: true,
          },
        }));
      },
    });
    pluginRegistrationDone = true;
  }

  captured = null;
  try {
    // Scoped, not a process-wide flag: the dev watcher calls this inside a live server, where the entry's side effects
    // must be suppressed only for the duration of the import.
    await runInEntryImportScope(async () => {
      if (opts?.fresh) {
        await freshImport(entryPath);
      } else {
        await import(Bun.pathToFileURL(entryPath).href);
      }
    });
  } catch (err) {
    if (!isHalt(err)) {
      throw err;
    }
  }

  return captured;
}

/** Returns the options the entry passed to `Mochi.serve()`, or `null` if it never called it (a standalone entry included). */
export async function extractServeOptions(entryPath: string, opts?: { fresh?: boolean }): Promise<Partial<MochiServeOptions> | null> {
  const result = await extractEntryCall(entryPath, opts);
  return result?.fn === 'serve' ? result.options : null;
}

/** Returns the options the entry passed to `Mochi.standalone()`, or `null` if it never called it (a serve entry included). */
export async function extractStandaloneOptions(entryPath: string, opts?: { fresh?: boolean }): Promise<MochiStandaloneOptions | null> {
  const result = await extractEntryCall(entryPath, opts);
  return result?.fn === 'standalone' ? result.options : null;
}
