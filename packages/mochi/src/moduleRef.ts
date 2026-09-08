import { createModuleRef } from './compiler/compiledSerialize';

/**
 * Mark a module to import rather than a value to serialize.
 *
 * Only meaningful in a `*.compiled.ts` module: the build turns each marker into a real `import` in the generated
 * module, which is how a build-time module can hand back components it cannot serialize.
 *
 * ```ts
 * moduleRef<Component>(`../../docs/${filename}`)
 * ```
 */
export function moduleRef<T = unknown>(specifier: string): T {
  return createModuleRef(specifier) as T;
}
