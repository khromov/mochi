import { createModuleRef, isModuleRef } from './compiler/compiledSerialize';

/**
 * Evaluate a function at build time and inline its resolved value.
 *
 * The compiler replaces the whole call — and an enclosing `await` — with the value the function returned, so neither
 * the function nor anything it imports reaches the bundle. The expression may reference module-level imports and
 * globals only; a reference to a local binding is a compile error, which is what keeps runes out of build-time code.
 *
 * ```ts
 * const sources = await compiled(() => loadSources(files));
 * ```
 *
 * This runtime implementation is what runs in dev, and the fallback for a call the compiler did not reach (an
 * un-transformed module, or a consumer bundling Mochi source directly): it simply runs the function, which is correct,
 * just not build-time.
 */
export async function compiled<T>(fn: () => T | Promise<T>): Promise<Awaited<T>> {
  const value = (await fn()) as Awaited<T>;
  assertNoModuleRefs(value);
  return value;
}

/**
 * A `moduleRef()` that reaches runtime would render as a bare marker. The compiler only keeps a module on the
 * build-time path in dev when it imports `moduleRef` itself, so a helper that mints the markers needs that hint.
 */
function assertNoModuleRefs(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }
  if (isModuleRef(value)) {
    throw new Error(
      'compiled() returned a moduleRef() but ran at request time. Import moduleRef from "mochi-framework" in the same module that calls compiled(), so the build evaluates it even in dev.',
    );
  }
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    assertNoModuleRefs(item, seen);
  }
}

/**
 * Mark a module to import rather than a value to serialize.
 *
 * Only meaningful inside a value returned from {@link compiled}: the compiler turns each marker into a real `import` in
 * the generated module, which is how a build-time function can hand back components it cannot serialize.
 *
 * ```ts
 * moduleRef<Component>(`../../docs/${filename}`)
 * ```
 */
export function moduleRef<T = unknown>(specifier: string): T {
  return createModuleRef(specifier) as T;
}
