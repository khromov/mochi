import { parse } from 'svelte/compiler';
import type { AST } from 'svelte/compiler';
import MagicString from 'magic-string';
import path from 'node:path';
import { walk } from 'zimmerframe';
import { ALSO_HYDRATE_ENVELOPE_KEY, type AlsoHydrateMode } from '../types';
import { FRAMEWORK_COMPONENTS_SPECIFIER, resolveFrameworkComponent } from './frameworkComponents';
import { encodeSourcePath } from './manifestPaths';

/** Svelte's AST nodes all have start/end, but estree types don't declare them. */
interface Positioned {
  start: number;
  end: number;
}

export interface HydratableComponent {
  /** Unique identity key (`<localName>_<hash>`, see `islandIdentity`) — the registry map key, `component-name` attribute, and placeholder key. */
  name: string;
  /** The bare local import identifier, for human-facing messages only (never an identity key). */
  displayName: string;
  resolvedPath: string;
  /** Export the component was imported from: `'default'` or a named export of the resolved module. */
  exportName: string;
}

export interface ServerIslandComponent {
  /** Unique identity key (`<localName>_<hash>`, see `islandIdentity`) — the registry map key, `component-name` attribute, and props AAD. */
  name: string;
  /** The bare local import identifier, for human-facing messages only (never an identity key). */
  displayName: string;
  resolvedPath: string;
  /** Export the component was imported from: `'default'` or a named export of the resolved module. */
  exportName: string;
}

/**
 * A `mochi:*` directive the preprocessor could not honour. Surfaced as a
 * compile error (via `ComponentRegistry.getErrors()`) rather than thrown, so
 * the dev error page can render it and the dev watcher can clear it on fix —
 * silently skipping would leave an inert component with no signal to the author.
 */
export interface UnresolvedIslandError {
  reason: 'unresolved';
  /** Bare component name as written in the template. */
  component: string;
  /** The directive that required resolution, e.g. `mochi:hydrate:visible`. */
  directive: string;
  /** Absolute path of the file containing the directive. */
  filePath: string;
  /** Import specifier when one exists but is unsupported (bare package, namespace, non-svelte source); null when no import matched at all. */
  importSource: string | null;
}

/** A `mochi:hydrate*` / `mochi:clientOnly*` directive on a `*.server.svelte`, whose client stub can only throw. */
export interface ServerOnlyIslandError {
  reason: 'server-only';
  component: string;
  directive: string;
  filePath: string;
  /** Absolute path of the `.server.svelte` the directive resolved to. */
  resolvedPath: string;
}

/**
 * Children on a plain `mochi:hydrate*` island. The client hydrates from serialized props alone —
 * there is no children snippet to hand to `hydrate()` — so server-rendered children silently
 * vanish on hydration. With `mochi:defer*` / `mochi:clientOnly*`, children are the fallback instead.
 */
export interface HydrateIslandChildrenError {
  reason: 'hydrate-children';
  component: string;
  directive: string;
  filePath: string;
}

export type PreprocessIslandError = UnresolvedIslandError | ServerOnlyIslandError | HydrateIslandChildrenError;

export interface PreprocessResult {
  transformed: string;
  hydratables: HydratableComponent[];
  serverIslands: ServerIslandComponent[];
  errors: PreprocessIslandError[];
}

/**
 * Rewrites `mochi:*` directives on child components into island wrappers, matching through Svelte's own parser
 * so the AST decides rather than a regex.
 *
 * - `mochi:hydrate` / `mochi:hydrate:visible` → `<mochi-hydratable-island>`
 * - `mochi:defer` / `mochi:defer:visible` → `<mochi-server-island>` with encrypted
 *   props; `:visible` adds `defer-on="visible"` so the client waits for
 *   IntersectionObserver before fetching
 * - Combined `mochi:defer*` + `mochi:hydrate*` → server island with `also-hydrate`,
 *   registered in both lists
 * - `mochi:clientOnly` → `<mochi-hydratable-island client-only>`, which skips the
 *   server entirely, turns any children into SSR placeholder markup, and mounts on
 *   the client
 */
export function preprocessHydratable(source: string, filePath: string): PreprocessResult {
  if (!source.includes('mochi:hydrate') && !source.includes('mochi:defer') && !source.includes('mochi:clientOnly')) {
    return { transformed: source, hydratables: [], serverIslands: [], errors: [] };
  }
  const ast = parse(source, { modern: true });
  const s = new MagicString(source);

  const { importMap, unsupportedImports, pidVar } = scanComponentImports(ast.instance);
  const pid = pidVar ?? '__mochi_pid__';

  const hydratables: HydratableComponent[] = [];
  const serverIslands: ServerIslandComponent[] = [];
  const errors: PreprocessIslandError[] = [];
  const seen = new Set<string>();
  const seenServer = new Set<string>();
  // Set by the hydrate/visible branch alone, since only those islands SSR in-page and so need the context boundary imported below.
  let needsBoundary = false;

  const emitClientOnlyIsland = (comp: AST.Component, directives: MochiDirectives, islandKey: string, resolved: string, exportName: string, dedupKey: string): string => {
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
    }

    // Children are the optional SSR fallback, emitted as placeholder markup and removed once the client mounts.
    // Static markup only: nested `mochi:*` islands stay untransformed and get wiped on mount.
    const fallback = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');

    // Nothing renders server-side, so there is no hydration id to carry and the payload dedups on serialized props alone.
    const propsExpr = buildPropsFromAst(source, comp.attributes);
    let attrs = `component-name="${islandKey}" component-url="__MOCHI_COMPONENT_URL__${islandKey}__" client-only`;
    if (propsExpr !== '{}') {
      attrs += ` props-ref={__mochi_emit_props__(${propsExpr})}`;
    }

    // `mochi:clientOnly:visible` defers `mount()` until the wrapper enters the viewport, reusing the hydratable visible path.
    const isVisible = directives.clientOnly!.name === 'mochi:clientOnly:visible';
    if (isVisible) {
      let visibleOptionsExpr: string | null = null;
      if (directives.clientOnly!.value !== true && !Array.isArray(directives.clientOnly!.value)) {
        const expr = directives.clientOnly!.value.expression as unknown as Positioned;
        visibleOptionsExpr = source.slice(expr.start, expr.end);
      }
      attrs += ` hydrate-on="visible" css-url="__MOCHI_CSS_URL__${islandKey}__"`;
      if (visibleOptionsExpr) {
        attrs += ` hydrate-options={JSON.stringify(${visibleOptionsExpr})}`;
      }
    }

    // The component skips SSR entirely, leaving no throw to catch and no hydration marker to force, so no `<svelte:boundary>`.
    return `<mochi-hydratable-island ${attrs}>${fallback}</mochi-hydratable-island>`;
  };

  const emitServerIsland = (comp: AST.Component, directives: MochiDirectives, islandKey: string, resolved: string, exportName: string, dedupKey: string): string => {
    if (!seenServer.has(dedupKey)) {
      seenServer.add(dedupKey);
      serverIslands.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
    }

    // The authored also-hydrate mode rides inside the encrypted envelope (`__mochi_ah`, transport-only, stripped before
    // render) and the endpoint reads it from the decrypted payload: were it trusted from a `?hydrate=` query param, an
    // attacker could append `hydrate=eager` to any sealed token and have the endpoint echo the props back in plaintext.
    const alsoHydrateMode: AlsoHydrateMode | null = directives.hydrate ? (directives.hydrate.name === 'mochi:hydrate:visible' ? 'visible' : 'eager') : null;
    const isServerVisible = directives.server!.name === 'mochi:defer:visible';

    // Extract directive options (e.g. mochi:defer={{retries: 10}} or
    // mochi:defer:visible={{rootMargin: '200px', retries: 5}})
    let serverOptionsExpr: string | null = null;
    if (directives.server!.value !== true && !Array.isArray(directives.server!.value)) {
      const exprTag = directives.server!.value;
      const expr = exprTag.expression as unknown as Positioned;
      serverOptionsExpr = source.slice(expr.start, expr.end);
    }

    if (directives.hydrate && !seen.has(dedupKey)) {
      seen.add(dedupKey);
      hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
    }

    // Children become fallback content
    const childrenSource = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');
    const alsoHydrateAttrs = directives.hydrate ? ` also-hydrate="${alsoHydrateMode}" component-url="__MOCHI_COMPONENT_URL__${islandKey}__"` : '';

    if (isServerVisible) {
      // `mochi:defer:visible` defers the fetch until the wrapper enters the viewport (`rootMargin` rides inside the
      // existing `server-options` JSON) — laziness is the point, so it is exempt from nested-island inlining.
      const autoEntries = directives.hydrate ? [`islandId: __mochi_iid`, `${ALSO_HYDRATE_ENVELOPE_KEY}: ${JSON.stringify(alsoHydrateMode)}`] : [`islandId: __mochi_iid`];
      const propsExpr = buildPropsFromAst(source, comp.attributes, autoEntries);
      // Server islands always emit signed-props, since islandId is always injected and every prop must be encrypted
      // against reads and tampering via query parameters. The component name is bound as AAD, so a token sealed for
      // one component can't be replayed against another.
      let attrs = `component-name="${islandKey}" signed-props={__mochi_encrypt_props__(__mochi_stringify__(${propsExpr}), ${JSON.stringify(islandKey)})} css-url="__MOCHI_SERVER_CSS_URL__${islandKey}__" data-asset-prefix="__MOCHI_ASSET_PREFIX__" defer-on="visible"`;
      if (serverOptionsExpr) {
        attrs += ` server-options={JSON.stringify(${serverOptionsExpr})}`;
      }
      attrs += alsoHydrateAttrs;
      return `{#if true}{@const __mochi_iid = \`\${${pid}}-\${__mochi_uid__++}\`}<mochi-server-island ${attrs}>${childrenSource}</mochi-server-island>{/if}`;
    }

    return serverInlineReplacement(comp, directives, islandKey, childrenSource, alsoHydrateAttrs, serverOptionsExpr, alsoHydrateMode);
  };

  // Non-visible defer sites branch at render time: inside an island-endpoint render (`shouldInlineIsland`), the child
  // renders in-process instead of emitting another fetch placeholder — the props are the same values the placeholder
  // would have sealed, so the inlined HTML is what the follow-up fetch would have returned. The `{@const}` bindings keep
  // user props/options expressions evaluated exactly once whichever branch is taken.
  function serverInlineReplacement(
    comp: AST.Component,
    directives: MochiDirectives,
    islandKey: string,
    childrenSource: string,
    alsoHydrateAttrs: string,
    serverOptionsExpr: string | null,
    alsoHydrateMode: AlsoHydrateMode | null,
  ): string {
    const userPropsExpr = buildPropsFromAst(source, comp.attributes);
    const optsRef = serverOptionsExpr ? '__mochi_sopts__' : null;
    const envelope = `{ ...__mochi_props__, islandId: __mochi_iid${directives.hydrate ? `, ${ALSO_HYDRATE_ENVELOPE_KEY}: ${JSON.stringify(alsoHydrateMode)}` : ''} }`;
    // Server islands always emit signed-props, since islandId is always injected and every prop must be encrypted
    // against reads and tampering via query parameters. The component name is bound as AAD, so a token sealed for
    // one component can't be replayed against another. Spreading `__mochi_props__` first keeps the envelope's key
    // order — and with it the deterministic encrypted token — byte-identical to the pre-inlining emission.
    let attrs = `component-name="${islandKey}" signed-props={__mochi_encrypt_props__(__mochi_stringify__(${envelope}), ${JSON.stringify(islandKey)})} css-url="__MOCHI_SERVER_CSS_URL__${islandKey}__" data-asset-prefix="__MOCHI_ASSET_PREFIX__"`;
    if (optsRef) {
      attrs += ` server-options={JSON.stringify(${optsRef})}`;
    }
    attrs += alsoHydrateAttrs;
    const placeholder = `<mochi-server-island ${attrs}>${childrenSource}</mochi-server-island>`;

    let inlineBody: string;
    if (directives.hydrate) {
      // Mirrors the island endpoint's also-hydrate wrapper (`props` attribute, no `hydrate-on`) so the inlined
      // fragment behaves like the fetched one, and the in-page hydrate branch's boundary nesting so hydration
      // markers land where client `hydrate()` expects them. The endpoint appends the bootstrap script for the
      // whole response via `result.bootstrapUrl`.
      needsBoundary = true;
      const propsAttr = userPropsExpr !== '{}' ? ` props={__mochi_stringify__(__mochi_props__)}` : '';
      inlineBody = `<MochiHydratableBoundary_><mochi-hydratable-island component-name="${islandKey}"${propsAttr} component-url="__MOCHI_COMPONENT_URL__${islandKey}__"><svelte:boundary><${comp.name} {...__mochi_props__} /></svelte:boundary></mochi-hydratable-island></MochiHydratableBoundary_>`;
    } else {
      inlineBody = `<${comp.name} {...__mochi_props__} />`;
    }

    // A throwing inlined child degrades to the placeholder (`failed` snippet), i.e. exactly the pre-inlining
    // behavior: the client fetches the island and a still-failing render returns the endpoint's failure stub.
    const consts =
      `{@const __mochi_iid = \`\${${pid}}-\${__mochi_uid__++}\`}` +
      (serverOptionsExpr ? `{@const __mochi_sopts__ = (${serverOptionsExpr})}` : '') +
      `{@const __mochi_props__ = (${userPropsExpr})}`;
    return `{#if true}${consts}{#if __mochi_inline_island__(${optsRef ?? ''})}<svelte:boundary>${inlineBody}{#snippet failed()}${placeholder}{/snippet}</svelte:boundary>{:else}${placeholder}{/if}{/if}`;
  }

  const emitHydrateIsland = (comp: AST.Component, directives: MochiDirectives, islandKey: string, resolved: string, exportName: string, dedupKey: string): string | null => {
    const mochiAttr = directives.hydrate!;

    const hasRealChildren = comp.fragment.nodes.some((n) => !(n.type === 'Text' && n.data.trim() === '') && n.type !== 'Comment');
    if (hasRealChildren) {
      errors.push({ reason: 'hydrate-children', component: comp.name, directive: mochiAttr.name, filePath });
      return null;
    }

    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
    }

    const propsSource = comp.attributes
      .filter((a) => !(a.type === 'Attribute' && a.name.startsWith('mochi:')))
      .map((a) => source.slice(a.start, a.end))
      .join(' ');

    const isVisible = mochiAttr.name === 'mochi:hydrate:visible';
    let visibleOptionsExpr: string | null = null;
    if (isVisible && mochiAttr.value !== true && !Array.isArray(mochiAttr.value)) {
      const exprTag = mochiAttr.value;
      const expr = exprTag.expression as unknown as Positioned;
      visibleOptionsExpr = source.slice(expr.start, expr.end);
    }

    const propsExpr = buildPropsFromAst(source, comp.attributes);
    let attrs = `component-name="${islandKey}" component-url="__MOCHI_COMPONENT_URL__${islandKey}__"`;
    // Skipping empty props keeps `{}` out of the HTML. `__mochi_emit_props__` registers the payload in the
    // per-request dedup map and returns a ref id, which ComponentRegistry's post-render HTMLRewriter pass turns
    // into a <script type="application/json"> block just before the payload's first island.
    if (propsExpr !== '{}') {
      attrs += ` props-ref={__mochi_emit_props__(${propsExpr})}`;
    }
    if (isVisible) {
      attrs += ` hydrate-on="visible"`;
      attrs += ` css-url="__MOCHI_CSS_URL__${islandKey}__"`;
      if (visibleOptionsExpr) {
        attrs += ` hydrate-options={JSON.stringify(${visibleOptionsExpr})}`;
      }
    }

    // Build the inner component tag. No framework props are injected — the
    // `isHydratable()` signal reaches the subtree via the context boundary
    // wrapper below, and components needing a unique id use Svelte's native
    // `$props.id()`.
    let innerTag: string;
    if (comp.fragment.nodes.length > 0) {
      const childrenSource = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');
      innerTag = `<${comp.name}${propsSource ? ' ' + propsSource : ''}>${childrenSource}</${comp.name}>`;
    } else {
      innerTag = `<${comp.name}${propsSource ? ' ' + propsSource : ''} />`;
    }

    // The outer <svelte:boundary> keeps an SSR throw inside the island from taking down the parent page render, and
    // sits outside <mochi-hydratable-island> so its <!--[-->…<!--]--> markers land at page level for
    // stripHydrationMarkers. SSR of `failed` needs `transformError` passed to `render()` (see ComponentRegistry.renderComponent).
    //
    // The INNER boundary is essential: a bare component invocation emits no hydration-block marker, so
    // <mochi-hydratable-island>'s firstChild would be the rendered element and Svelte's `hydrate()` — which walks
    // children for `<!--[-->` / HYDRATION_START — throws HYDRATION_ERROR and falls back to `mount()`, silently
    // losing hydration and breaking `hydratable()` lookups.
    const failedSnippet =
      `{#snippet failed(error)}` + `<mochi-island-failure data-component=${JSON.stringify(comp.name)} data-message={error.message}></mochi-island-failure>` + `{/snippet}`;
    // The `{#if true}` wrapper gives each island its own scope: every island declares `{#snippet failed}` under the
    // same name, and Svelte otherwise collapses them into one shared snippet, so a throwing island would render a
    // sibling's failure stub.
    //
    // <MochiHydratableBoundary_> seeds the `isHydratable()` context for the island root and its whole subtree, and
    // must sit outside <mochi-hydratable-island>: its `{@render children?.()}` emits a trailing `<!---->` SSR anchor
    // that would otherwise land before the inner boundary's `<!--]-->` and break client `hydrate()` (see the note above).
    needsBoundary = true;
    return (
      `{#if true}<svelte:boundary>${failedSnippet}` +
      `<MochiHydratableBoundary_><mochi-hydratable-island ${attrs}><svelte:boundary>${innerTag}</svelte:boundary></mochi-hydratable-island></MochiHydratableBoundary_>` +
      `</svelte:boundary>{/if}`
    );
  };

  walk(ast.fragment as AST.SvelteNode, null, {
    Component(comp, { next }) {
      const directives = findMochiDirectives(comp.attributes);
      if (!directives.server && !directives.hydrate && !directives.clientOnly) {
        next();
        return;
      }

      // `islandId` is reserved on every directive alike, so a component can move between them without a prop
      // silently changing meaning; on `mochi:defer` it is the transport key inside the signed envelope.
      const islandDirective = directives.clientOnly ?? directives.server ?? directives.hydrate!;

      const entry = importMap.get(comp.name);
      if (!entry) {
        errors.push({
          reason: 'unresolved',
          component: comp.name,
          directive: islandDirective.name,
          filePath,
          importSource: unresolvedImportSource(comp.name, importMap, unsupportedImports),
        });
        next();
        return;
      }

      const resolved = path.resolve(path.dirname(filePath), entry.source);

      // `mochi:defer` alone stays legal — a deferred `.server.svelte` never ships client code.
      const clientDirective = directives.hydrate ?? directives.clientOnly;
      if (clientDirective && resolved.endsWith('.server.svelte')) {
        errors.push({ reason: 'server-only', component: comp.name, directive: clientDirective.name, filePath, resolvedPath: resolved });
        next();
        return;
      }
      const exportName = entry.exportName;
      const dedupKey = `${resolved}\0${exportName}`;

      // Per-component-file identity keying the `component-name` attribute, the server-island endpoint path, the
      // props-encryption AAD, the `__MOCHI_*__<id>__` placeholders, and the registry maps — see `islandIdentity`
      // for why the bare `comp.name` below, still used for the Svelte tag and error text, can't serve as the key.
      const islandKey = islandIdentity(comp.name, resolved, exportName);

      assertNoReservedIslandIdProp(comp, islandDirective);

      if (directives.clientOnly) {
        s.overwrite(comp.start, comp.end, emitClientOnlyIsland(comp, directives, islandKey, resolved, exportName, dedupKey));
      } else if (directives.server) {
        s.overwrite(comp.start, comp.end, emitServerIsland(comp, directives, islandKey, resolved, exportName, dedupKey));
      } else {
        const replacement = emitHydrateIsland(comp, directives, islandKey, resolved, exportName, dedupKey);
        if (replacement === null) {
          next();
          return;
        }
        s.overwrite(comp.start, comp.end, replacement);
      }

      next();
    },
  });

  injectIslandRuntimeImports(s, ast.instance, hydratables.length > 0, serverIslands.length > 0, needsBoundary, pidVar);

  return { transformed: s.toString(), hydratables, serverIslands, errors };
}

// For dotted names (`<NS.Widget>`), the base identifier's import is the one worth naming in the compile error.
function unresolvedImportSource(name: string, importMap: Map<string, { source: string; exportName: string }>, unsupportedImports: Map<string, string>): string | null {
  const base = name.split('.')[0]!;
  return unsupportedImports.get(name) ?? unsupportedImports.get(base) ?? importMap.get(base)?.source ?? null;
}

function assertNoReservedIslandIdProp(comp: AST.Component, islandDirective: AST.Attribute): void {
  for (const attr of comp.attributes) {
    if (attr.type === 'Attribute' && attr.name === 'islandId') {
      throw new Error(
        `\`islandId\` is a reserved framework name and cannot be passed as a prop to a \`${islandDirective.name}\` island. ` +
          `For a unique id inside ${comp.name}, use Svelte's \`$props.id()\`.`,
      );
    }
  }
}

// Inject the runtime imports the rewritten island markup references into the component's <script> tag.
function injectIslandRuntimeImports(
  s: MagicString,
  instance: AST.Root['instance'],
  hasHydratables: boolean,
  hasServerIslands: boolean,
  needsBoundary: boolean,
  pidVar: string | null,
): void {
  const needsEmitProps = hasHydratables;
  const needsStringify = hasServerIslands;
  const needsSignProps = hasServerIslands;
  // Only server islands need the `__mochi_iid` transport id, riding inside their signed envelope as `idPrefix` for the
  // standalone render; the other kinds let Svelte recover `$props.id()` from its own `<!--$...-->` markers.
  const needsUid = hasServerIslands;

  if (!(needsEmitProps || needsStringify || needsSignProps || needsBoundary) || !instance) {
    return;
  }
  const contentStart = (instance.content as unknown as Positioned).start;
  let imports = '';
  if (needsEmitProps) {
    imports += '\nimport { emitIslandProps as __mochi_emit_props__ } from "mochi-framework";';
  }
  if (needsBoundary) {
    imports += '\nimport MochiHydratableBoundary_ from "mochi-framework/hydratable-boundary";';
  }
  if (needsStringify) {
    imports += '\nimport { stringify as __mochi_stringify__ } from "mochi-framework";';
  }
  if (needsUid) {
    imports += '\nlet __mochi_uid__ = 0;';
    // Island ids are `${$props.id()}-${counter}`: the rune is unique per component instance per render and the counter
    // separates multiple islands inside one instance, staying SSR-stable because Svelte reads the id back from its marker.
    if (!pidVar) {
      imports += '\nconst __mochi_pid__ = $props.id();';
    }
  }
  if (needsSignProps) {
    imports += '\nimport { encryptProps as __mochi_encrypt_props__, shouldInlineIsland as __mochi_inline_island__ } from "mochi-server-island-runtime";';
  }
  s.appendRight(contentStart, imports);
}

/**
 * Stable, unique identity for an island, serving as the `component-name` attribute, the props-encryption AAD, and the key
 * for every registry map (`serverIslandPaths`, `componentEntryUrls`, …).
 *
 * A bare local import name collides across a project: a `Widget.svelte` in `./a` and another in `./b`, each imported as
 * `Widget`, both key on `"Widget"`, and the last-write-wins registry `Map` silently drops one so its island renders the
 * other's component — with matching AAD, the encrypted props even decrypt cleanly. Hashing the resolved file path into the
 * suffix makes the identity per-file, and the result stays a valid `\w+` token so it survives the `__MOCHI_*__<id>__`
 * placeholder regexes and `encodeURIComponent` unchanged.
 *
 * The hash derives only from the source path (base36 of a 64-bit hash), so it is
 * stable for a given file and never leaks the path into client HTML. It hashes
 * the *encoded* path — the same project-root-relative form the manifest stores —
 * so two machines building the same commit produce identical island names, and
 * with them identical client bundle filenames and SSR'd HTML. Named exports mix
 * the export name into the hash so two exports of one module (or two local
 * aliases of different exports) stay distinct.
 */
function islandIdentity(name: string, resolvedPath: string, exportName: string): string {
  const encoded = encodeSourcePath(resolvedPath);
  const identity = exportName === 'default' ? encoded : `${encoded}#${exportName}`;
  return `${name}_${Bun.hash(identity).toString(36)}`;
}

interface ScannedImports {
  importMap: Map<string, { source: string; exportName: string }>;
  unsupportedImports: Map<string, string>;
  pidVar: string | null;
}

type InstanceBody = NonNullable<AST.Root['instance']>['content']['body'];
type ImportNode = Extract<InstanceBody[number], { type: 'ImportDeclaration' }>;
type VariableNode = Extract<InstanceBody[number], { type: 'VariableDeclaration' }>;

// Svelte allows one `$props.id()` per component (`props_duplicate`), so an author's existing declaration has to be
// reused rather than shadowed. Only top-level instance-script declarations are scanned; a `$props.id()` nested in a
// function or snippet slips through and collides, which stays unhandled until someone hits it.
function scanComponentImports(instance: AST.Root['instance']): ScannedImports {
  const importMap = new Map<string, { source: string; exportName: string }>();
  // Local names bound by imports the island pipeline can't handle (bare package specifiers, namespace imports,
  // non-svelte sources), kept so a directive on one of them can name the offending specifier in its compile error.
  const unsupportedImports = new Map<string, string>();
  let pidVar: string | null = null;
  if (!instance) {
    return { importMap, unsupportedImports, pidVar };
  }
  for (const node of instance.content.body) {
    if (node.type === 'ImportDeclaration' && typeof node.source.value === 'string') {
      registerComponentImport(node, node.source.value, importMap, unsupportedImports);
    } else if (node.type === 'VariableDeclaration') {
      pidVar = findPropsIdVar(node.declarations) ?? pidVar;
    }
  }
  return { importMap, unsupportedImports, pidVar };
}

function registerComponentImport(
  node: ImportNode,
  importSource: string,
  importMap: Map<string, { source: string; exportName: string }>,
  unsupportedImports: Map<string, string>,
): void {
  const specifiers = node.specifiers ?? [];
  // Resolving the framework's own public components to their on-disk `.svelte` lets a directive sit straight on the
  // package import (`<MochiCaptcha mochi:hydrate />`). Only named imports resolve; the rest fall through to the usual
  // unresolved-island error.
  if (importSource === FRAMEWORK_COMPONENTS_SPECIFIER) {
    registerFrameworkComponentImports(specifiers, importMap, unsupportedImports);
    return;
  }
  const supported =
    /\.(svelte|md|svx)$/.test(importSource) && // TODO: Needs to be configurable to support arbitrary extensions
    (importSource.startsWith('./') || importSource.startsWith('../') || path.isAbsolute(importSource));
  for (const spec of specifiers) {
    if (supported && spec.type === 'ImportDefaultSpecifier') {
      importMap.set(spec.local.name, { source: importSource, exportName: 'default' });
    } else if (supported && spec.type === 'ImportSpecifier') {
      const exportName = spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value);
      importMap.set(spec.local.name, { source: importSource, exportName });
    } else {
      unsupportedImports.set(spec.local.name, importSource);
    }
  }
}

function registerFrameworkComponentImports(
  specifiers: ImportNode['specifiers'],
  importMap: Map<string, { source: string; exportName: string }>,
  unsupportedImports: Map<string, string>,
): void {
  for (const spec of specifiers) {
    const framework = spec.type === 'ImportSpecifier' && spec.imported.type === 'Identifier' ? resolveFrameworkComponent(spec.imported.name) : null;
    if (framework) {
      importMap.set(spec.local.name, { source: framework.resolvedPath, exportName: framework.exportName });
    } else {
      unsupportedImports.set(spec.local.name, FRAMEWORK_COMPONENTS_SPECIFIER);
    }
  }
}

function findPropsIdVar(declarations: VariableNode['declarations']): string | null {
  for (const decl of declarations) {
    if (
      decl.id.type === 'Identifier' &&
      decl.init?.type === 'CallExpression' &&
      decl.init.callee.type === 'MemberExpression' &&
      decl.init.callee.object.type === 'Identifier' &&
      decl.init.callee.object.name === '$props' &&
      decl.init.callee.property.type === 'Identifier' &&
      decl.init.callee.property.name === 'id'
    ) {
      return decl.id.name;
    }
  }
  return null;
}

interface MochiDirectives {
  server: AST.Attribute | null;
  hydrate: AST.Attribute | null;
  clientOnly: AST.Attribute | null;
}

/** Find `mochi:defer*`, `mochi:hydrate*`, and `mochi:clientOnly*` attributes on a component. */
function findMochiDirectives(attributes: Array<AST.Attribute | AST.SpreadAttribute | AST.Directive | AST.AttachTag>): MochiDirectives {
  let server: AST.Attribute | null = null;
  let hydrate: AST.Attribute | null = null;
  let clientOnly: AST.Attribute | null = null;
  for (const attr of attributes) {
    if (attr.type === 'Attribute') {
      if (attr.name === 'mochi:defer' || attr.name === 'mochi:defer:visible') {
        if (server) {
          throw new Error(`Cannot use both \`${server.name}\` and \`${attr.name}\` on the same component — pick one.`);
        }
        server = attr;
      } else if (attr.name === 'mochi:hydrate' || attr.name === 'mochi:hydrate:visible') {
        hydrate = attr;
      } else if (attr.name === 'mochi:clientOnly' || attr.name === 'mochi:clientOnly:visible') {
        clientOnly = attr;
      }
    }
  }
  if (clientOnly && (server || hydrate)) {
    throw new Error(`Cannot combine \`mochi:clientOnly\` with \`${(server ?? hydrate)!.name}\` — a client-only component is never server-rendered.`);
  }
  return { server, hydrate, clientOnly };
}

/**
 * Build a JS object expression from AST attributes, skipping `mochi:*` attrs. `extraEntries` are framework-owned keys
 * appended last so they win over a user spread, since a `{...rest}` carrying `islandId` would otherwise shadow the transport id.
 */
function buildPropsFromAst(source: string, attributes: Array<AST.Attribute | AST.SpreadAttribute | AST.Directive | AST.AttachTag>, extraEntries: string[] = []): string {
  const entries: string[] = [];
  for (const attr of attributes) {
    if (attr.type === 'SpreadAttribute') {
      const expr = attr.expression as unknown as Positioned;
      entries.push(`...${source.slice(expr.start, expr.end)}`);
    } else if (attr.type === 'Attribute') {
      if (attr.name.startsWith('mochi:')) {
        continue;
      }
      if (attr.value === true) {
        entries.push(`${attr.name}: true`);
      } else if (!Array.isArray(attr.value)) {
        const expr = attr.value.expression as unknown as Positioned;
        entries.push(`${attr.name}: ${source.slice(expr.start, expr.end)}`);
      } else {
        const parts = attr.value;
        const hasExpr = parts.some((v) => v.type !== 'Text');
        if (!hasExpr) {
          // `JSON.stringify` escapes embedded quotes and backslashes, so `title='He said "hi"'` still emits valid JS.
          // Reading the decoded `data` rather than the raw source hands HTML entities like `&amp;` to the component as `&`,
          // matching the `{expr}` path.
          const text = parts.map((v) => (v.type === 'Text' ? v.data : '')).join('');
          entries.push(`${attr.name}: ${JSON.stringify(text)}`);
        } else {
          // Mixed text and expression (`title="Hello {name}"`) emits a template literal so the expression interpolates
          // instead of being spliced in as literal source text, reading decoded `data` as the pure-text branch does.
          const tpl = parts
            .map((v) => {
              if (v.type === 'Text') {
                // TODO: This is a bit jank and should be refactored
                return v.data.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
              }
              const expr = v.expression as unknown as Positioned;
              return '${' + source.slice(expr.start, expr.end) + '}';
            })
            .join('');
          // TODO: This is a bit jank and should be refactored
          entries.push(`${attr.name}: \`${tpl}\``);
        }
      }
    }
  }
  entries.push(...extraEntries);
  return `{${entries.join(', ')}}`;
}
