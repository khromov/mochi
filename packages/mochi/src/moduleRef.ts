import { prerenderEvaluation, createModuleRef } from './compiler/prerenderSerialize';

/**
 * Mark a module to import rather than a value to serialize.
 *
 * Only meaningful in a `*.prerender.ts` module: the build turns each marker into a real `import` in the generated
 * module, which is how a prerendered module can hand back components it cannot serialize.
 *
 * ```ts
 * moduleRef<Component>(`../../docs/${filename}`)
 * ```
 */
export function moduleRef<T = unknown>(specifier: string): T {
  if (prerenderEvaluation.active === 0) {
    throw new Error(
      `moduleRef(${JSON.stringify(specifier)}) was called outside a build-time evaluation. ` +
        'A *.prerender.ts module is only replaced when a .svelte or .md file imports it; imported from the server entry (routes.ts, an API handler), it runs as a plain module.',
    );
  }
  return createModuleRef(specifier) as T;
}
