import { compiledEvaluation, createModuleRef } from './compiler/compiledSerialize';

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
  if (compiledEvaluation.active === 0) {
    throw new Error(
      `moduleRef(${JSON.stringify(specifier)}) was called outside a build-time evaluation. ` +
        'A *.compiled.ts module is only replaced when a .svelte or .md file imports it; imported from the server entry (routes.ts, an API handler), it runs as a plain module.',
    );
  }
  return createModuleRef(specifier) as T;
}
