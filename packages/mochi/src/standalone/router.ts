import { mount, unmount } from 'svelte';
import type { MochiPageConfig } from '../types';
import { logger } from '../utils/log';
import { getRouteComponent } from './clientRegistry';

/**
 * Match a hash path against a route pattern. Segments match literally except `:param` segments, which capture their
 * (decoded) value. Returns the captured params, or `null` when the pattern doesn't match.
 */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(path);
  if (patternSegments.length !== pathSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const expected = patternSegments[i]!;
    const actual = pathSegments[i]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** Static patterns win over `:param` patterns; within each class, declaration order decides. */
export function resolveRoute(routes: Record<string, MochiPageConfig>, path: string): { pattern: string; page: MochiPageConfig; params: Record<string, string> } | null {
  const entries = Object.entries(routes);
  for (const withParams of [false, true]) {
    for (const [pattern, page] of entries) {
      if (pattern.includes(':') !== withParams) {
        continue;
      }
      const params = matchRoute(pattern, path);
      if (params) {
        return { pattern, page, params };
      }
    }
  }
  return null;
}

export interface StandaloneRouterHandle {
  /** Resolves once the initial route has rendered. */
  ready: Promise<void>;
  navigate(path: string): void;
  stop(): void;
}

/**
 * Minimal hash-based router for standalone apps: `#/todos/42` renders the route matching `/todos/:id`. An empty hash
 * means `/`. Each navigation resolves the route's `clientProps`, then `mount()`s the component into `target` —
 * never `hydrate()`, since a standalone shell ships no server-rendered HTML.
 */
export function startHashRouter(opts: { routes: Record<string, MochiPageConfig>; notFound?: MochiPageConfig; loading?: MochiPageConfig; target: Element }): StandaloneRouterHandle {
  // Bumped per navigation so a stale async clientProps resolution can't mount over a newer route.
  let generation = 0;
  let mounted: Record<string, unknown> | null = null;

  function currentPath(): string {
    const raw = window.location.hash.replace(/^#/, '');
    return raw === '' ? '/' : raw;
  }

  function clear(): void {
    if (mounted) {
      void unmount(mounted);
      mounted = null;
    }
    opts.target.innerHTML = '';
  }

  async function render(): Promise<void> {
    const generationAtStart = ++generation;
    const path = currentPath();
    const match = resolveRoute(opts.routes, path);
    if (!match && !opts.notFound) {
      logger.warn(`[mochi] No standalone route matches "${path}" and no \`notFound\` page is configured.`);
      clear();
      return;
    }
    const page = match?.page ?? opts.notFound!;
    const params = match?.params ?? {};
    const component = getRouteComponent(page.componentPath);
    if (!component) {
      logger.error(`[mochi] No component registered for "${page.componentPath}" — the standalone build did not include it.`);
      clear();
      return;
    }
    let props: Record<string, unknown> = {};
    if (page.clientProps) {
      // The route's data is genuinely async, so the loading page (when configured) mounts for the whole wait — the
      // generation guard below still discards this render if the user navigates away mid-load.
      if (opts.loading) {
        const loadingComponent = getRouteComponent(opts.loading.componentPath);
        if (loadingComponent) {
          clear();
          mounted = mount(loadingComponent, { target: opts.target, props: {} });
        }
      }
      try {
        props = (await page.clientProps(params)) ?? {};
      } catch (err) {
        logger.error(`[mochi] clientProps for "${match?.pattern ?? path}" threw:`, err);
        if (generationAtStart === generation) {
          clear();
        }
        return;
      }
    }
    if (generationAtStart !== generation) {
      return;
    }
    clear();
    mounted = mount(component, { target: opts.target, props });
  }

  const onHashChange = () => {
    void render();
  };
  window.addEventListener('hashchange', onHashChange);

  return {
    ready: render(),
    navigate(path: string) {
      window.location.hash = path.startsWith('#') ? path.slice(1) : path;
    },
    stop() {
      window.removeEventListener('hashchange', onHashChange);
      generation++;
      clear();
    },
  };
}
