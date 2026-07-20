import path from 'node:path';
import { freshImport } from '../compiler/freshImport';
import type { MochiServeOptions } from '../types';

// Thrown by the capturing serve() stub to unwind the entry module's top-level
// `await Mochi.serve(...)` before the real server binds a port. Symbol-keyed so a
// user's own `throw {}` can never be mistaken for it.
const HALT = Symbol('mochi.extract.halt');
type HaltSignal = { [HALT]: true };
function isHalt(err: unknown): err is HaltSignal {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[HALT] === true;
}

let pluginRegistrationDone = false;
let captured: Partial<MochiServeOptions> | null = null;

/**
 * Import a Mochi entry module (e.g. `src/index.ts`) far enough to capture the
 * options object it passes to `Mochi.serve()`, without starting the server.
 *
 * A `Bun.plugin` virtual module overrides the bare `mochi-framework` specifier:
 * it re-exports the real framework entry (imported by absolute file path so the
 * plugin doesn't intercept itself) but replaces `Mochi.serve` with a stub that
 * records its argument and throws a sentinel to halt the entry's top-level
 * `await Mochi.serve(...)`. The captured object is fully evaluated, so options
 * like `optimize` are exactly what the runtime would use.
 *
 * Returns the captured options, or `null` if the entry never called `serve()`.
 */
export async function extractServeOptions(entryPath: string, opts?: { fresh?: boolean }): Promise<Partial<MochiServeOptions> | null> {
  // The real framework entry, by absolute path — NOT the bare specifier, so the
  // plugin below does not intercept this import (no recursion). This file lives
  // in `src/cli/`, so climb one level to reach it.
  const realMod = (await import(path.join(import.meta.dir, '..', 'index.ts'))) as Record<string, unknown> & {
    Mochi: object;
  };

  if (!pluginRegistrationDone) {
    // A Proxy preserves Mochi's non-enumerable static methods
    // (page/api/ws/sse) so route modules still build during extraction; only
    // `serve` is swapped for the capturing stub.
    const mochiProxy = new Proxy(realMod.Mochi, {
      get(target, prop, receiver) {
        if (prop === 'serve') {
          // Synchronous capture + throw, before serve()'s first await, so the
          // sentinel rejects the entry's top-level await and unwinds cleanly.
          return (options: Partial<MochiServeOptions>) => {
            // A second call within one extraction means the entry swallowed our
            // halt sentinel (e.g. `try { await Mochi.serve(...) } catch {}`) and
            // kept running. Throw a real error so the extractor surfaces it
            // instead of silently capturing duplicate/stale options.
            if (captured !== null) {
              throw new Error(
                'Mochi.serve() was called more than once while extracting build options. Do not wrap the top-level Mochi.serve() call in try/catch — it must be allowed to throw during extraction.',
              );
            }
            captured = options;
            throw { [HALT]: true } as HaltSignal;
          };
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
          },
        }));
      },
    });
    pluginRegistrationDone = true;
  }

  captured = null;
  try {
    if (opts?.fresh) {
      await freshImport(entryPath);
    } else {
      await import(Bun.pathToFileURL(entryPath).href);
    }
  } catch (err) {
    if (!isHalt(err)) {
      throw err;
    }
  }

  return captured;
}
