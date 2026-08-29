import path from 'node:path';
import { toPosixPath } from '../utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MochiComponentRef = string | import('svelte').Component<any>;

/**
 * Collapse a route's component reference to the project-relative path the compiler indexes it by. An imported
 * `.svelte` arrives either as the preload plugin's tagged stub (`__source`) or, with no plugin registered, as Bun's
 * file-loader value — the absolute path — so both forms resolve without one.
 */
export function resolveComponentPath(component: MochiComponentRef, label: string): string {
  if (typeof component === 'string') {
    return component;
  }
  const source = (component as unknown as { __source?: string }).__source;
  if (!source) {
    throw new Error(
      `[mochi] ${label} received a Svelte component with no source file attached. Add preload = ["mochi-framework/plugin"] to your bunfig.toml so .svelte imports carry their path, or pass the path as a string.`,
    );
  }
  const rel = toPosixPath(path.relative(process.cwd(), source));
  return rel.startsWith('.') ? rel : './' + rel;
}
