import { createModuleRef, isModuleRef } from './compiler/compiledSerialize';

/**
 * Evaluate a function at build time and inline its resolved value.
 *
 * The compiler replaces the whole call — and an enclosing `await` — with the value the function returned, so neither
 * the function nor anything it imports reaches the bundle. The expression may reference module-level imports and
 * globals only; a reference to a local binding is a compile error.
 *
 * ```ts
 * const sources = await compiled(() => loadSources(files));
 * ```
 *
 * This body runs only in dev, and as the fallback for a call the compiler never reached.
 */
export async function compiled<T>(fn: () => T | Promise<T>): Promise<Awaited<T>> {
  const value = (await fn()) as Awaited<T>;
  assertNoModuleRefs(value);
  return value;
}

/** A `moduleRef()` that reaches runtime would render as a bare marker, so fail loudly instead. */
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
